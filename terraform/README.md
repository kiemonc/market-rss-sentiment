# Terraform — Cloud Functions (2nd gen) deployment

Provisions everything needed to run the scraper as a Google Cloud Function (2nd gen),
triggered on a schedule:

- Cloud Storage bucket + zipped source upload (the function is deployed from source;
  the Cloud Functions buildpack runs `npm install` then the `gcp-build` script, i.e. `tsc`)
- `google_cloudfunctions2_function` (Node.js 20, HTTP trigger, entry point `app`)
- Pub/Sub topic for published articles
- Two service accounts: one runtime identity for the function (`roles/pubsub.publisher`,
  `roles/logging.logWriter`), one for Cloud Scheduler to invoke the function via OIDC
- `google_cloud_scheduler_job` that POSTs to `/scrape` on a cron schedule
- IAM: the function is **not** publicly invokable by default — only the scheduler's
  service account gets `roles/run.invoker` (set `allow_unauthenticated = true` to change that)

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
