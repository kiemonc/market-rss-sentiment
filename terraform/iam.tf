# Runtime identity for the function: only what it needs to publish articles.
resource "google_service_account" "function_runtime" {
  account_id   = "${var.function_name}-runtime"
  display_name = "Runtime SA for ${var.function_name} Cloud Function"
  project      = var.project_id
}

resource "google_pubsub_topic_iam_member" "function_publisher" {
  topic  = google_pubsub_topic.articles.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.function_runtime.email}"
}

resource "google_project_iam_member" "function_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.function_runtime.email}"
}

# Identity Cloud Scheduler uses to invoke the function's HTTP endpoint via OIDC.
resource "google_service_account" "scheduler_invoker" {
  account_id   = "${var.function_name}-scheduler"
  display_name = "Cloud Scheduler invoker for ${var.function_name}"
  project      = var.project_id
}

# Cloud Functions (2nd gen) run on Cloud Run under the hood; invoker
# permission is granted on the underlying Cloud Run service.
resource "google_cloud_run_v2_service_iam_member" "scheduler_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.scraper.service_config[0].service
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler_invoker.email}"
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count = var.allow_unauthenticated ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.scraper.service_config[0].service
  role     = "roles/run.invoker"
  member   = "allUsers"
}
