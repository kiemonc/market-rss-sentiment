# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
./npm.sh install          # this host's Node is via nvm, not on default PATH — use
                           # this wrapper, or `npm install` directly if yours is
npm run build              # tsc -> dist/
npm run dev                 # build + serve locally via functions-framework on :8080
npm test                    # vitest run (all tests, once)
npm run test:watch          # vitest watch mode
npx vitest run src/consumer.test.ts   # single test file
npx vitest run -t "writes a valid article"   # single test by name
```

Terraform (in `terraform/`): `terraform init`, `terraform plan`, `terraform apply`.
See `docs/operacje.md` for the full deploy/verify workflow and a table of every
real gotcha already hit (GCS bucket name / service-account `account_id` length
limits, Cloud Scheduler's `attempt_deadline` cap, etc.) — check it before
re-deriving something that's already documented there.

## Architecture

Full pipeline: RSS feeds → **scraper** (Cloud Function, HTTP) → dedup + full-content
fetch → Pub/Sub topic `market-articles` → **consumer** (Cloud Function, Eventarc
trigger) → Firestore (`articles/{id}`). Deep dive: `docs/architektura.md` (data flow,
code map, payload contract) and `docs/infrastruktura.md` (every Terraform resource,
IAM, variables, real deployed output values).

**The one non-obvious fact that matters most**: both Cloud Functions are deployed
from the *same* zipped source and the *same* compiled `dist/`, differing only by
`entry_point` (`app` vs `consumeArticle`). `@google-cloud/functions-framework`
always loads `package.json`'s `main` (`dist/index.js`) regardless of which
`entry_point` a given deployment uses — it doesn't look for a file named after the
target. So **any new HTTP/CloudEvent function must be registered via a side-effect
import in `src/index.ts`** (see the `import './consumer'` there), or it will deploy
successfully but fail every invocation with "Function '...' is not defined".

Other structural points:
- `src/config.ts` is the single place reading environment variables; everything
  else takes a `Config` object rather than touching `process.env` directly.
- `src/publishers/` is a small strategy pattern (`Publisher` interface) with two
  implementations selected by `PUBLISHER_TYPE`: `GoogleCloudPublisher` (Pub/Sub,
  what's actually deployed) and `FilePublisher` (JSONL, local dev only —
  `createPublisher()` is the factory in `src/publishers/index.ts`).
- `src/consumer.ts` is intentionally a single flat file, not a parallel
  `storage/`-style abstraction — there is exactly one consumer, so an abstraction
  layer would be premature. Its error handling deliberately distinguishes
  permanent failures (bad payload — log and return, no retry) from transient ones
  (Firestore write fails — rethrow so Pub/Sub retries); see the comments there
  before changing that logic.
- Terraform provisions both functions from one `data.archive_file` zip of the
  whole repo (`terraform/storage.tf`) — a code change forces a new zip hash and
  redeploys both functions on the next `apply`, even if only one of them changed.
- Tests are colocated (`src/**/*.test.ts`), Vitest, and excluded from
  `tsconfig.json`'s `include` so they never end up in the production build/deploy
  zip. `@google-cloud/pubsub` and `@google-cloud/firestore` are mocked with real
  `function` constructors, not arrow functions (arrow functions can't be called
  with `new`, which is what those SDKs' classes require).
