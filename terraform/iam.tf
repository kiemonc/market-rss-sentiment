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

# Runtime identity for the Firestore consumer function: write access to
# Firestore plus logging. There's no built-in role scoped to a single
# collection for server-side (Admin SDK) access — that's what Firestore
# Security Rules are for, and those don't apply to service-account access.
resource "google_service_account" "consumer_runtime" {
  # account_id is capped at 30 chars by GCP (and can't end in "-"); truncate to
  # fit regardless of consumer_function_name's length (same issue hit earlier
  # with GCS bucket names).
  account_id   = trimsuffix(substr("${var.consumer_function_name}-runtime", 0, 30), "-")
  display_name = "Runtime SA for ${var.consumer_function_name} Cloud Function"
  project      = var.project_id
}

resource "google_project_iam_member" "consumer_datastore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.consumer_runtime.email}"
}

resource "google_project_iam_member" "consumer_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.consumer_runtime.email}"
}

resource "google_project_iam_member" "consumer_eventarc_receiver" {
  project = var.project_id
  role    = "roles/eventarc.eventReceiver"
  member  = "serviceAccount:${google_service_account.consumer_runtime.email}"
}

# Eventarc invokes the consumer function's underlying Cloud Run service using
# the event_trigger's service_account_email; that identity needs run.invoker
# on that service, same pattern as scheduler_invoker above for the scraper.
resource "google_cloud_run_v2_service_iam_member" "consumer_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.consumer.service_config[0].service
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.consumer_runtime.email}"
}
