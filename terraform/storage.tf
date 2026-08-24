resource "random_id" "source_bucket_suffix" {
  byte_length = 4
}

locals {
  # GCS bucket names are capped at 63 chars; leave room for the "-" + 8 hex
  # char suffix that keeps the name globally unique.
  source_bucket_prefix = substr("${var.project_id}-${var.function_name}-src", 0, 54)
  source_bucket_name   = "${local.source_bucket_prefix}-${random_id.source_bucket_suffix.hex}"
}

resource "google_storage_bucket" "function_source" {
  name                        = local.source_bucket_name
  location                    = var.region
  project                     = var.project_id
  uniform_bucket_level_access = true
  force_destroy               = true

  depends_on = [google_project_service.apis]
}

# Zips the repository (minus local/dev-only artifacts) so it can be uploaded
# for the Cloud Functions buildpack build. The buildpack runs `npm install`
# and then the `gcp-build` script (`tsc`) defined in package.json.
data "archive_file" "function_source" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/.tmp/function-source.zip"

  excludes = [
    "node_modules",
    "dist",
    ".git",
    ".idea",
    "articles",
    "terraform",
    ".env",
    ".env.local",
    "*.log",
  ]
}

resource "google_storage_bucket_object" "function_source" {
  name   = "source-${data.archive_file.function_source.output_md5}.zip"
  bucket = google_storage_bucket.function_source.name
  source = data.archive_file.function_source.output_path
}
