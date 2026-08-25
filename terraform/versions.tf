terraform {
  required_version = ">= 1.5.0"

  # Bucket/prefix are passed via `-backend-config=backend.hcl` (gitignored,
  # copy from backend.hcl.example) instead of being hardcoded here, since the
  # state bucket name is per-project. The bucket itself is created out of
  # band (gcloud storage buckets create ...), not by this Terraform config —
  # a config must not manage the bucket that stores its own state, or
  # `terraform destroy` could delete the state out from under itself.
  backend "gcs" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# The Firebase resources (google_firebase_project, google_firebase_web_app,
# google_firebase_hosting_site, ...) are still beta-only in the upstream API.
provider "google-beta" {
  project = var.project_id
  region  = var.region
}
