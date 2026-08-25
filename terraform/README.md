# Terraform — Cloud Functions (2nd gen) deployment

Provisions everything needed to run the scraper as a Google Cloud Function (2nd gen),
triggered on a schedule, plus a second function that consumes published articles into
Firestore:

- Cloud Storage bucket + zipped source upload (both functions are deployed from the
  same source; the Cloud Functions buildpack runs `npm install` then the `gcp-build`
  script, i.e. `tsc`, producing one shared `dist/` used by both)
- `google_cloudfunctions2_function.scraper` (Node.js 24, HTTP trigger, entry point `app`)
- Pub/Sub topic for published articles
- `google_cloudfunctions2_function.consumer` (Node.js 24, Pub/Sub/Eventarc trigger,
  entry point `consumeArticle`) — writes each article to Firestore (`articles/{id}`,
  default database, native mode)
- Service accounts: a runtime identity for the scraper (`roles/pubsub.publisher`,
  `roles/logging.logWriter`), one for Cloud Scheduler to invoke it via OIDC, and a
  runtime identity for the consumer (`roles/datastore.user`, `roles/logging.logWriter`,
  `roles/eventarc.eventReceiver`)
- `google_cloud_scheduler_job` that POSTs to `/scrape` on a cron schedule
- IAM: neither function is publicly invokable by default — the scraper's `run.invoker`
  is granted only to the scheduler's service account (set `allow_unauthenticated = true`
  to change that); the consumer's is granted only to its own service account (Eventarc
  invokes through it) and its `ingress_settings` is `ALLOW_INTERNAL_ONLY`
- `firebase.tf`: Firebase for the `../frontend` Angular app — registers a Firebase Web
  App, writes its real SDK config into `frontend/src/environments/environment.ts`,
  deploys `frontend/firestore.rules` (public read / no write on `articles`), and builds
  + deploys `frontend/dist` to a Firebase Hosting site via a `local-exec` provisioner
  (the `google_firebase_hosting_version` resource only manages rewrites/headers, not
  actual file content — the Terraform Google provider cannot upload static assets on
  its own, so this shells out to the Firebase CLI)

## Prerequisites

- `gcloud auth application-default login` (or a service account key via
  `GOOGLE_APPLICATION_CREDENTIALS`) with permissions to enable APIs and manage the
  resources above (e.g. `roles/owner` or an equivalent custom role) on the target project
- An existing GCP project with billing enabled

## Usage

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: project_id, rss_feeds, schedule, ...

terraform init
terraform plan
terraform apply
```

Terraform enables the required APIs itself (`apis.tf`), so a fresh project works too —
first `apply` may take a few minutes while APIs propagate.

## Frontend (Firebase)

`apply` also provisions `../frontend`: run `npm install` there once beforehand (the
`local-exec` provisioner runs `npm run build`, it doesn't install dependencies), then
`terraform apply` will register the Firebase Web App, deploy the Firestore rules, and
build + deploy the Angular app to `https://<hosting_site_id>.web.app` (see the
`hosting_url` output). The Firebase CLI deploy step (`npx firebase-tools deploy`) reuses
whatever credentials the `google`/`google-beta` providers are using (ADC), so no separate
`firebase login` is needed as long as that identity has the Firebase Hosting Admin and
Firebase Rules Admin roles.

`hosting_site_id` (in `terraform.tfvars`) must be globally unique across all Firebase
projects — it defaults to `<project_id>-frontend`.

## Notes

- **Redeploys**: re-running `terraform apply` after changing `src/`, `package.json`, etc.
  re-zips the repo and uploads a new source object (named by its MD5 hash), which forces
  a new function revision.
- **RSS feeds**: `var.rss_feeds` is passed to the function as the `RSS_FEEDS` env var
  (JSON-encoded) — no code change needed to add/remove feeds, just update `terraform.tfvars`.
- **Manual trigger**: `gcloud scheduler jobs run <job-name> --location=<region>`, or invoke
  the function URL directly with an identity token:
  `curl -X POST -H "Authorization: Bearer $(gcloud auth print-identity-token)" <function_url>/scrape`
- **State**: this config uses local state by default. For anything beyond solo experimentation,
  configure a remote backend (e.g. a GCS bucket) in `versions.tf` before running `apply`.
- **Timeout**: `timeout_seconds` (default 3600s) bounds how long a single `/scrape` run can
  take — `/scrape` now runs to completion before responding, so it must fit inside this window.
- **Firestore**: a GCP project has exactly one default database, locked to whichever mode
  (native vs Datastore) it was first created in. `google_firestore_database.default` assumes
  none exists yet; if `apply` fails because one already exists in a different mode/location,
  `terraform import google_firestore_database.default "projects/<project>/databases/(default)"`
  and adjust `firestore_location` to match instead of trying to create a fresh one.
- **Consumer retries**: `consumer_retry_policy` (default `RETRY_POLICY_RETRY`) only governs
  Firestore write failures — `src/consumer.ts` deliberately does not rethrow on unparseable
  messages (nothing would be gained by retrying those), only on Firestore errors.
