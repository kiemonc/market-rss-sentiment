output "function_url" {
  description = "HTTPS URL of the deployed Cloud Function."
  value       = google_cloudfunctions2_function.scraper.url
}

output "pubsub_topic" {
  description = "Pub/Sub topic articles are published to."
  value       = google_pubsub_topic.articles.name
}

output "function_service_account" {
  description = "Runtime service account email used by the function."
  value       = google_service_account.function_runtime.email
}

output "scheduler_service_account" {
  description = "Service account Cloud Scheduler uses to invoke the function."
  value       = google_service_account.scheduler_invoker.email
}

output "scheduler_job" {
  description = "Name of the Cloud Scheduler job triggering /scrape."
  value       = google_cloud_scheduler_job.trigger_scrape.name
}

output "consumer_function_name" {
  description = "Name of the Firestore consumer Cloud Function."
  value       = google_cloudfunctions2_function.consumer.name
}

output "consumer_service_account" {
  description = "Runtime service account email used by the consumer function."
  value       = google_service_account.consumer_runtime.email
}

output "sentiment_consumer_function_name" {
  description = "Name of the LLM sentiment-analysis Cloud Function."
  value       = google_cloudfunctions2_function.sentiment_consumer.name
}

output "sentiment_consumer_service_account" {
  description = "Runtime service account email used by the sentiment-analysis consumer function."
  value       = google_service_account.sentiment_consumer_runtime.email
}

output "firestore_database" {
  description = "Firestore database name/id backing article storage."
  value       = google_firestore_database.default.name
}

output "firebase_web_app_id" {
  description = "Firebase Web App ID registered for the frontend."
  value       = google_firebase_web_app.frontend.app_id
}

output "hosting_url" {
  description = "URL of the deployed Angular frontend."
  value       = "https://${local.hosting_site_id}.web.app"
}
