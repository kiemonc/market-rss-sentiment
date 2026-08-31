resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  concurrency_mode = "PESSIMISTIC"
  deletion_policy  = "ABANDON" # don't delete article data on `terraform destroy`

  depends_on = [google_project_service.apis]
}

# The frontend's source filter combines a `source` equality filter with an `orderBy` on a
# different field (`fetchedAt`, `publishedAt`, or `title`), which Firestore can only serve with
# a composite index (a single-field filter + orderBy on the same field doesn't need one).
# Firestore doesn't reverse-serve a composite index for the opposite sort direction, and the
# frontend's column-header sort can go either way, so both directions are indexed for each field.
locals {
  source_sort_indexes = {
    for pair in setproduct(["fetchedAt", "publishedAt", "title"], ["ASCENDING", "DESCENDING"]) :
    "${pair[0]}_${pair[1]}" => { field = pair[0], order = pair[1] }
  }
}

resource "google_firestore_index" "articles_source_sort" {
  for_each = local.source_sort_indexes

  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = var.firestore_collection

  fields {
    field_path = "source"
    order      = "ASCENDING"
  }
  fields {
    field_path = each.value.field
    order      = each.value.order
  }
}
