# Market RSS Sentiment Analyzer

RSS scraper for market news with pluggable publishers (Google Cloud Pub/Sub or local file).

## Features

- 🔄 RSS feed scraping with deduplication
- 📄 Full article content resolution (HTML parsing + text extraction)
- 📤 Pluggable publishers: Google Cloud Pub/Sub or local file
- 🌐 Express-based HTTP API, deployed as a Cloud Function (2nd gen)
- ⚙️ Environment-based configuration
- ☁️ Terraform-managed GCP deployment (Cloud Functions, Pub/Sub, Cloud Scheduler)
- 📝 TypeScript with full type safety
- ⚡ Smart caching & rate limiting for content fetching

## Quick Start

### 1. Local Setup

```bash
./npm.sh install
```

(Or `npm install` if Node.js is in your PATH)

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env` with your RSS feeds (JSON format):

```env
RSS_FEEDS=[{"name":"bloomberg","url":"https://feeds.bloomberg.com/markets/news.rss"}]
GCP_PROJECT_ID=your-gcp-project
PUBSUB_TOPIC=market-articles
```

### 2. Build & Run

The app is a Cloud Functions (2nd gen) HTTP function, served locally via the
[Functions Framework](https://github.com/GoogleCloudPlatform/functions-framework-nodejs):

**Development (local file publisher):**

```bash
npm run dev
# builds, then serves on http://localhost:8080 via functions-framework
```

Articles will be saved to `./articles/articles.jsonl` (JSONL format).

**Production-like (GCP Pub/Sub):**

```bash
PUBLISHER_TYPE=gcp npm run dev
```

Ensure `GCP_PROJECT_ID` and `PUBSUB_TOPIC` are set in `.env` or environment.

### 3. Trigger Scrape

```bash
curl -X POST http://localhost:8080/scrape
```

Check status:

```bash
curl http://localhost:8080/scrape-status
```

## Publishers

The app supports two publishers, selectable via `PUBLISHER_TYPE` environment variable:

### File Publisher (Development - Default)
Saves articles to JSONL file (one JSON per line) in `./articles/articles.jsonl`.

```bash
PUBLISHER_TYPE=file
ARTICLES_OUTPUT_DIR=./articles
```

Useful for local testing, CI/CD pipelines, or demos.

### Google Cloud Pub/Sub (Production)
Publishes articles to Google Cloud Pub/Sub topic for async processing.

```bash
PUBLISHER_TYPE=gcp
GCP_PROJECT_ID=your-gcp-project
PUBSUB_TOPIC=market-articles
```

Perfect for serverless architectures and cloud-native deployments.

- `GET /health` — Health check
- `POST /scrape` — Run a full RSS scrape (runs to completion before responding)
- `GET /scrape-status` — Check if a scrape is running

## Testing

```bash
npm test          # run once
npm run test:watch
```

Unit tests (Vitest) cover the scraper, content resolver, both publishers, the consumer,
config parsing, and the Express routes — with `node-fetch`, `@google-cloud/pubsub`, and
`@google-cloud/firestore` mocked out, so there's no network or GCP dependency. Test files
live next to the code they cover (`src/**/*.test.ts`) and are excluded from the production
build (see `tsconfig.json`).

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | HTTP server port |
| `NODE_ENV` | development | Set to `production` for Cloud Run |
| `PUBLISHER_TYPE` | file (dev), gcp (prod) | Publisher: `file` or `gcp` |
| `ARTICLES_OUTPUT_DIR` | ./articles | Output directory for file publisher |
| `GCP_PROJECT_ID` | test-project | Google Cloud Project ID (for gcp publisher) |
| `PUBSUB_TOPIC` | market-articles | Pub/Sub topic name (for gcp publisher) |
| `RSS_FEEDS` | [] | JSON array of feed objects: `[{"name":"...", "url":"..."}]` |
| `PUBSUB_EMULATOR_HOST` | (empty) | For local testing with Pub/Sub emulator: `localhost:8085` |

## GCP Deployment (Cloud Functions 2nd gen, via Terraform)

The app deploys as two Cloud Functions (2nd gen): the scraper, triggered on a schedule
by Cloud Scheduler and publishing to Pub/Sub, and a consumer, triggered directly by
that Pub/Sub topic, which writes each article into Firestore. Everything (functions,
topic, Firestore database, service accounts, scheduler job, IAM) is provisioned with
Terraform — see [`terraform/`](./terraform):

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: project_id, rss_feeds, schedule, ...

terraform init
terraform apply
```

`/scrape` runs synchronously to completion (bounded by `timeout_seconds`, default
3600s) rather than the fire-and-forget pattern used for a long-lived server — Cloud
Functions instances aren't guaranteed to keep running after a response is sent.

Full details, including how to redeploy after code changes and how to trigger a
manual run, are in [`terraform/README.md`](./terraform/README.md).

The `Dockerfile` is kept only for local container testing (`docker build . && docker
run -p 8080:8080 <image>`) — it is not part of the GCP deployment path.

## Local Development with Pub/Sub Emulator

Start the emulator:

```bash
gcloud beta emulators pubsub start --host-port=localhost:8085
```

In another terminal:

```bash
export PUBSUB_EMULATOR_HOST=localhost:8085
npm start
```

## Architecture

```
RSS Feeds → Scraper → Deduplication → Pub/Sub Topic → Consumer → Firestore
```

- **Scraper** fetches RSS feeds concurrently
- **Deduplication** uses MD5 hash of title+link to avoid duplicates
- **Pub/Sub** decouples scraping from processing (sentiment analysis, storage, etc.)
- **Consumer** (`src/consumer.ts`) writes each article to Firestore (`articles/{id}`,
  upserted so redelivery is idempotent); further processing (e.g. sentiment analysis)
  can subscribe to the same topic independently

Link do diagramu architektury: https://app.diagrams.net/#Hkiemonc%2Fmarket-rss-sentiment%2Fmain%2Farchitecture.drawio