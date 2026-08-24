resource "google_cloudfunctions2_function" "consumer" {
  name     = var.consumer_function_name
  location = var.region
  project  = var.project_id

  build_config {
    runtime     = "nodejs24"
    entry_point = "consumeArticle" # matches functions.cloudEvent('consumeArticle', ...) in src/consumer.ts

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    available_memory      = var.consumer_available_memory
    available_cpu         = var.consumer_available_cpu
    timeout_seconds       = var.consumer_timeout_seconds
    min_instance_count    = var.consumer_min_instance_count
    max_instance_count    = var.consumer_max_instance_count
    service_account_email = google_service_account.consumer_runtime.email

    # Only Eventarc calls in — not meant to be reachable from the internet,
    # unlike the scraper (which needs to be reachable by Cloud Scheduler/curl).
    ingress_settings = "ALLOW_INTERNAL_ONLY"

    environment_variables = {
      NODE_ENV             = "production"
      GCP_PROJECT_ID       = var.project_id
      FIRESTORE_COLLECTION = var.firestore_collection
    }
  }

  event_trigger {
    trigger_region        = var.region
    event_type            = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic          = google_pubsub_topic.articles.id
    retry_policy          = var.consumer_retry_policy
    service_account_email = google_service_account.consumer_runtime.email
  }

  depends_on = [
    google_project_service.apis,
    google_firestore_database.default,
    google_project_iam_member.consumer_datastore_user,
    google_project_iam_member.consumer_log_writer,
    google_project_iam_member.consumer_eventarc_receiver,
  ]
}
