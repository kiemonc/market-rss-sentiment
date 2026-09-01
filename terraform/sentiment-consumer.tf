resource "google_cloudfunctions2_function" "sentiment_consumer" {
  name     = var.sentiment_consumer_function_name
  location = var.region
  project  = var.project_id

  build_config {
    runtime     = "nodejs24"
    entry_point = "analyzeArticleSentiment" # matches functions.cloudEvent('analyzeArticleSentiment', ...) in src/sentiment-consumer.ts

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    available_memory      = var.sentiment_consumer_available_memory
    available_cpu         = var.sentiment_consumer_available_cpu
    timeout_seconds       = var.sentiment_consumer_timeout_seconds
    min_instance_count    = var.sentiment_consumer_min_instance_count
    max_instance_count    = var.sentiment_consumer_max_instance_count
    service_account_email = google_service_account.sentiment_consumer_runtime.email

    # Same reasoning as the Firestore consumer: only Eventarc calls in.
    ingress_settings = "ALLOW_INTERNAL_ONLY"

    environment_variables = {
      NODE_ENV             = "production"
      GCP_PROJECT_ID       = var.project_id
      VERTEX_AI_LOCATION   = var.vertex_ai_location
      VERTEX_AI_MODEL      = var.vertex_ai_model
      SENTIMENT_COLLECTION = var.sentiment_collection
    }
  }

  # Separate Eventarc trigger/subscription on the same topic as the Firestore consumer
  # (consumer.tf) — both consumers independently receive every published article.
  event_trigger {
    trigger_region        = var.region
    event_type            = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic          = google_pubsub_topic.articles.id
    retry_policy          = var.sentiment_consumer_retry_policy
    service_account_email = google_service_account.sentiment_consumer_runtime.email
  }

  depends_on = [
    google_project_service.apis,
    google_firestore_database.default,
    google_project_iam_member.sentiment_consumer_datastore_user,
    google_project_iam_member.sentiment_consumer_log_writer,
    google_project_iam_member.sentiment_consumer_eventarc_receiver,
    google_project_iam_member.sentiment_consumer_vertex_ai_user,
  ]
}
