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

output "firestore_database" {
  description = "Firestore database name/id backing article storage."
  value       = google_firestore_database.default.name
}
