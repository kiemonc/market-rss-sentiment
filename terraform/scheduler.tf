resource "google_cloud_scheduler_job" "trigger_scrape" {
  name             = "${var.function_name}-scrape"
  project          = var.project_id
  region           = var.region
  schedule         = var.schedule
  time_zone        = var.schedule_time_zone
  # Cloud Scheduler caps attempt_deadline at 30 minutes, even though the
  # function itself may allow up to 60 (timeout_seconds).
  attempt_deadline = "${min(var.timeout_seconds, 1800)}s"

  http_target {
    uri         = "${google_cloudfunctions2_function.scraper.url}/scrape"
    http_method = "POST"

    oidc_token {
      service_account_email = google_service_account.scheduler_invoker.email
      # Audience must be the function's base URL (no path) for Cloud Run's
      # OIDC check to validate the token, even though uri includes /scrape.
      audience = google_cloudfunctions2_function.scraper.url
    }
  }

  depends_on = [
    google_project_service.apis,
    google_cloud_run_v2_service_iam_member.scheduler_invoker,
  ]
}
