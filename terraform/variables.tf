variable "project_id" {
  description = "GCP project ID to deploy into."
  type        = string
}

variable "region" {
  description = "GCP region for the function, Pub/Sub topic and scheduler job."
  type        = string
  default     = "us-central1"
}

variable "function_name" {
  description = "Name of the Cloud Function (2nd gen)."
  type        = string
  default     = "market-rss-sentiment"
}

variable "pubsub_topic" {
  description = "Name of the Pub/Sub topic articles are published to."
  type        = string
  default     = "market-articles"
}

variable "rss_feeds" {
  description = "RSS feeds to scrape, as a list of {name, url} objects."
  type = list(object({
    name = string
    url  = string
  }))
  default = [
    { name = "cointelegraph", url = "https://cointelegraph.com/rss" },
    { name = "decrypt", url = "https://decrypt.co/feed" },
    { name = "bitcoinmagazine", url = "https://bitcoinmagazine.com/feed" },
    { name = "cryptoslate", url = "https://cryptoslate.com/feed/" },
    { name = "newsbtc", url = "https://www.newsbtc.com/feed/" },
  ]
}

variable "available_memory" {
  description = "Memory allocated to the function (e.g. '512Mi', '1Gi')."
  type        = string
  default     = "512Mi"
}

variable "available_cpu" {
  description = "vCPUs allocated to the function."
  type        = string
  default     = "1"
}

variable "timeout_seconds" {
  description = "Max request duration. A full scrape run must finish within this window."
  type        = number
  default     = 3600
}

variable "min_instance_count" {
  description = "Minimum warm instances (0 = scale to zero between scheduled runs)."
  type        = number
  default     = 0
}

variable "max_instance_count" {
  description = "Maximum concurrent instances."
  type        = number
  default     = 1
}

variable "schedule" {
  description = "Cron schedule (Cloud Scheduler syntax) for triggering /scrape."
  type        = string
  default     = "0 */6 * * *"
}

variable "schedule_time_zone" {
  description = "Time zone used to evaluate `schedule`."
  type        = string
  default     = "Etc/UTC"
}

variable "allow_unauthenticated" {
  description = "If true, allow public/unauthenticated invocations of the function's HTTP endpoint. Keep false and let Cloud Scheduler invoke it via OIDC."
  type        = bool
  default     = false
}

variable "source_dir" {
  description = "Path to the repository root (source zipped for the Cloud Functions build)."
  type        = string
  default     = ".."
}

variable "firestore_location" {
  description = "Firestore database location (region or multi-region id, e.g. 'us-central1', 'nam5')."
  type        = string
  default     = "us-central1"
}

variable "firestore_collection" {
  description = "Firestore collection articles are written to."
  type        = string
  default     = "articles"
}

variable "consumer_function_name" {
  description = "Name of the Pub/Sub-triggered Firestore consumer Cloud Function."
  type        = string
  default     = "market-rss-sentiment-consumer"
}

variable "consumer_available_memory" {
  description = "Memory allocated to the consumer function."
  type        = string
  default     = "256Mi"
}

variable "consumer_available_cpu" {
  description = "vCPUs allocated to the consumer function."
  type        = string
  default     = "1"
}

variable "consumer_timeout_seconds" {
  description = "Per-invocation timeout for the consumer function."
  type        = number
  default     = 60
}

variable "consumer_min_instance_count" {
  description = "Minimum warm instances for the consumer function."
  type        = number
  default     = 0
}

variable "consumer_max_instance_count" {
  description = "Maximum concurrent instances for the consumer function."
  type        = number
  default     = 5
}

variable "consumer_retry_policy" {
  description = "RETRY_POLICY_RETRY or RETRY_POLICY_DO_NOT_RETRY for the Pub/Sub event trigger."
  type        = string
  default     = "RETRY_POLICY_RETRY"
}

variable "sentiment_consumer_function_name" {
  description = "Name of the Pub/Sub-triggered LLM sentiment-analysis Cloud Function."
  type        = string
  default     = "market-rss-sentiment-sentiment-consumer"
}

variable "sentiment_consumer_available_memory" {
  description = "Memory allocated to the sentiment-analysis consumer function."
  type        = string
  default     = "512Mi"
}

variable "sentiment_consumer_available_cpu" {
  description = "vCPUs allocated to the sentiment-analysis consumer function."
  type        = string
  default     = "1"
}

variable "sentiment_consumer_timeout_seconds" {
  description = "Per-invocation timeout for the sentiment-analysis consumer function (the Vertex AI call dominates)."
  type        = number
  default     = 120
}

variable "sentiment_consumer_min_instance_count" {
  description = "Minimum warm instances for the sentiment-analysis consumer function."
  type        = number
  default     = 0
}

variable "sentiment_consumer_max_instance_count" {
  description = "Maximum concurrent instances for the sentiment-analysis consumer function."
  type        = number
  default     = 5
}

variable "sentiment_consumer_retry_policy" {
  description = "RETRY_POLICY_RETRY or RETRY_POLICY_DO_NOT_RETRY for the sentiment-analysis consumer's Pub/Sub event trigger."
  type        = string
  default     = "RETRY_POLICY_RETRY"
}

variable "vertex_ai_location" {
  description = "Vertex AI region for the sentiment-analysis LLM calls."
  type        = string
  default     = "us-central1"
}

variable "vertex_ai_model" {
  description = "Vertex AI generative model used for per-article sentiment analysis."
  type        = string
  default     = "gemini-2.5-flash-lite"
}

variable "sentiment_collection" {
  description = "Firestore collection per-article coin-sentiment results are written to."
  type        = string
  default     = "sentiment"
}

variable "hosting_site_id" {
  description = "Firebase Hosting site id for the Angular frontend (must be globally unique across all Firebase projects). Defaults to '<project_id>-frontend'."
  type        = string
  default     = null
}
