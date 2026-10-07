resource "google_cloudfunctions2_function" "scraper" {
  name     = var.function_name
  location = var.region
  project  = var.project_id

  build_config {
    runtime     = "nodejs24"
    entry_point = "app" # matches functions.http('app', app) in src/index.ts

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    available_memory      = var.available_memory
    available_cpu         = var.available_cpu
    timeout_seconds       = var.timeout_seconds
    min_instance_count    = var.min_instance_count
    max_instance_count    = var.max_instance_count
    service_account_email = google_service_account.function_runtime.email

    # Unauthenticated access is denied at the IAM layer (see iam.tf); Cloud
    # Scheduler calls in with an OIDC token from the scheduler_invoker SA.
    ingress_settings = "ALLOW_ALL"

    environment_variables = {
      NODE_ENV       = "production"
      PUBLISHER_TYPE = "gcp"
      GCP_PROJECT_ID = var.project_id
      PUBSUB_TOPIC   = google_pubsub_topic.articles.name
      RSS_FEEDS      = jsonencode(var.rss_feeds)
      # Read-only: to skip articles an earlier run already stored (src/known-articles.ts).
      FIRESTORE_COLLECTION = var.firestore_collection
    }
  }

  depends_on = [
    google_project_service.apis,
    google_pubsub_topic_iam_member.function_publisher,
    google_project_iam_member.function_datastore_viewer,
  ]
}
