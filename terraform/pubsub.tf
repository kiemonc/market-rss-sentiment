resource "google_pubsub_topic" "articles" {
  name    = var.pubsub_topic
  project = var.project_id

  depends_on = [google_project_service.apis]
}
