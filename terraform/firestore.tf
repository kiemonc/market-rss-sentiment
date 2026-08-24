resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  concurrency_mode = "PESSIMISTIC"
  deletion_policy  = "ABANDON" # don't delete article data on `terraform destroy`

  depends_on = [google_project_service.apis]
}
