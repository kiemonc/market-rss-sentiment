resource "google_cloud_scheduler_job" "trigger_scrape" {
  name             = "${var.function_name}-scrape"
  project          = var.project_id
  region           = var.region
  schedule         = var.schedule
  time_zone        = var.schedule_time_zone
  attempt_deadline = "${var.timeout_seconds}s"

  http_target {
    uri         = google_cloudfunctions2_function.scraper.url
    http_method = "POST"

    oidc_token {
      service_account_email = google_service_account.scheduler_invoker.email
      audience              = google_cloudfunctions2_function.scraper.url
    }
  }

  depends_on = [
    google_project_service.apis,
    google_cloud_run_v2_service_iam_member.scheduler_invoker,
  ]
}
