# Infrastruktura (Terraform)

Wszystko poniżej jest w `terraform/*.tf` i wdrożone w projekcie GCP `cloud-playground-mchmielecki`
(region `us-central1`). Wartości output'ów poniżej to realny stan po ostatnim `apply`
(2026-08-24) — jeśli zmienisz `terraform.tfvars`, część z nich się zmieni.

## Zasoby

| Zasób | Plik | Nazwa / wartość |
|---|---|---|
| Cloud Function (scraper) | `function.tf` | `market-rss-sentiment`, Node.js 24, HTTP, entry point `app` |
| Cloud Function (consumer) | `consumer.tf` | `market-rss-sentiment-consumer`, Node.js 24, trigger Eventarc/Pub/Sub, entry point `consumeArticle` |
| Pub/Sub topic | `pubsub.tf` | `market-articles` |
| Firestore database | `firestore.tf` | `(default)`, native mode, `us-central1`, `deletion_policy = ABANDON` |
| Cloud Scheduler job | `scheduler.tf` | `market-rss-sentiment-scrape`, cron `0 */6 * * *` (UTC), POST `{function_url}/scrape` z OIDC |
| GCS bucket (źródło) | `storage.tf` | `{project_id}-{function_name}-src-{losowy hex}` (nazwa obcinana do 63 znaków — limit GCS) |
| Service accounts | `iam.tf` | patrz tabela IAM niżej |

Obie funkcje (scraper i consumer) dzielą **ten sam zip źródeł** (`data.archive_file.function_source`
w `storage.tf`, zipuje cały katalog repo minus `node_modules`/`dist`/`.git`/`.idea`/`articles`/`terraform`)
i ten sam skompilowany `dist/` — różni je tylko `entry_point`. Zmiana w `src/` wymusza nowy hash
zipa → nowy `google_storage_bucket_object` → redeploy obu funkcji przy kolejnym `apply`.

## IAM

| Service account | Role | Po co |
|---|---|---|
| `market-rss-sentiment-runtime` | `roles/pubsub.publisher` (na topicu), `roles/logging.logWriter` | runtime scrapera — publikuje artykuły |
| `market-rss-sentiment-scheduler` | `roles/run.invoker` (na Cloud Run service scrapera) | Cloud Scheduler woła `/scrape` przez OIDC z tą tożsamością |
| `market-rss-sentiment-consumer` | `roles/datastore.user`, `roles/logging.logWriter`, `roles/eventarc.eventReceiver`, `roles/run.invoker` (na własnym Cloud Run service) | runtime konsumenta — zapis do Firestore + odbiór eventów z Eventarc |

Żadna z funkcji nie jest publicznie wywoływalna domyślnie:
- scraper: `ingress_settings = ALLOW_ALL`, ale invoker tylko dla `scheduler` SA
  (`allow_unauthenticated = true` to zmienia — patrz `variables.tf`)
- consumer: `ingress_settings = ALLOW_INTERNAL_ONLY` — tylko Eventarc może wywołać

## Zmienne (`variables.tf`) — wartości domyślne

| Zmienna | Domyślna | Dotyczy |
|---|---|---|
| `region` | `us-central1` | obu funkcji, topicu, schedulera |
| `function_name` | `market-rss-sentiment` | scraper |
| `pubsub_topic` | `market-articles` | topic |
| `rss_feeds` | cointelegraph, decrypt, bitcoinmagazine, cryptoslate, newsbtc | scraper (`RSS_FEEDS` env) |
| `available_memory` / `available_cpu` | `512Mi` / `1` | scraper |
| `timeout_seconds` | `3600` | scraper (`/scrape` musi się zmieścić) |
| `min_instance_count` / `max_instance_count` | `0` / `1` | scraper |
| `schedule` / `schedule_time_zone` | `0 */6 * * *` / `Etc/UTC` | Cloud Scheduler |
| `allow_unauthenticated` | `false` | scraper — publiczny dostęp HTTP |
| `firestore_location` | `us-central1` | Firestore |
| `firestore_collection` | `articles` | konsument (`FIRESTORE_COLLECTION` env) |
| `consumer_function_name` | `market-rss-sentiment-consumer` | konsument |
| `consumer_available_memory` / `consumer_available_cpu` | `256Mi` / `1` | konsument |
| `consumer_timeout_seconds` | `60` | konsument |
| `consumer_min_instance_count` / `consumer_max_instance_count` | `0` / `5` | konsument |
| `consumer_retry_policy` | `RETRY_POLICY_RETRY` | trigger Eventarc konsumenta |

## Outputs (realny stan po ostatnim apply)

```
function_url              = https://us-central1-cloud-playground-mchmielecki.cloudfunctions.net/market-rss-sentiment
consumer_function_name    = market-rss-sentiment-consumer
pubsub_topic               = market-articles
firestore_database         = (default)
scheduler_job              = market-rss-sentiment-scrape
function_service_account   = market-rss-sentiment-runtime@cloud-playground-mchmielecki.iam.gserviceaccount.com
scheduler_service_account  = market-rss-sentiment-scheduler@cloud-playground-mchmielecki.iam.gserviceaccount.com
consumer_service_account   = market-rss-sentiment-consumer@cloud-playground-mchmielecki.iam.gserviceaccount.com
```

(URL konsumenta nie jest jeszcze osobnym outputem — to
`https://us-central1-cloud-playground-mchmielecki.cloudfunctions.net/market-rss-sentiment-consumer`,
ale w praktyce nikt go nie woła bezpośrednio, bo `ingress_settings = ALLOW_INTERNAL_ONLY`.)

## Runtime

Obie funkcje: **Node.js 24** (`nodejs24`). Zmienione z `nodejs20` 2026-08-24, bo ten runtime
w Cloud Functions ma deprecation `2026-04-30` i decommission `2026-10-30`. `@google-cloud/firestore@^9`
wymaga Node ≥22, więc pasuje. Lokalny `Dockerfile` (tylko do testów kontenerowych, nieużywany
przy wdrożeniu na GCP) też stoi na `node:24-alpine`.
