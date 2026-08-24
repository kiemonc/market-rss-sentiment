# Operacje

## Wdrożenie / redeploy

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars   # tylko za pierwszym razem
# edytuj terraform.tfvars: project_id, rss_feeds, schedule, ...

terraform init
terraform plan     # przejrzyj co się zmieni
terraform apply
```

Redeploy po zmianie kodu: wystarczy `terraform apply` ponownie — zip źródeł przelicza się
za każdym razem (`data.archive_file`), a jego nazwa w GCS zawiera hash MD5, więc realna
zmiana w `src/`/`package.json` wymusza nowy `google_storage_bucket_object` i tym samym nową
rewizję obu Cloud Functions.

## Ręczne testowanie

**Scraper** (wymaga tokenu tożsamości, bo funkcja nie jest publiczna):
```bash
curl -X POST -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  https://us-central1-cloud-playground-mchmielecki.cloudfunctions.net/market-rss-sentiment/scrape
```

**Konsument** — nie da się go wywołać bezpośrednio (`ALLOW_INTERNAL_ONLY`), testuje się
publikując wiadomość na topic:
```bash
gcloud pubsub topics publish market-articles --project=cloud-playground-mchmielecki \
  --message='{"id":"test-001","title":"T","link":"https://example.com","description":"d","content":"c","source":"manual-test","pubDate":"2026-08-24T00:00:00.000Z","fetchedAt":"2026-08-24T00:00:00.000Z"}'

gcloud functions logs read market-rss-sentiment-consumer \
  --region=us-central1 --project=cloud-playground-mchmielecki --gen2 --limit=20

# sprawdzenie że dokument realnie wylądował w Firestore:
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://firestore.googleapis.com/v1/projects/cloud-playground-mchmielecki/databases/(default)/documents/articles/test-001"
```

Ten dokładny test (zapis, idempotencja przy powtórnej publikacji tej samej wiadomości,
oraz ścieżka błędu trwałego przy `--message='not valid json'`) był wykonany end-to-end
2026-08-24 i przeszedł w całości.

## Znane pułapki i ich obejścia (napotkane realnie w tym projekcie)

| Problem | Objaw | Rozwiązanie |
|---|---|---|
| Nazwa bucketa GCS > 63 znaki | `Error 400: ... invalid` przy tworzeniu `google_storage_bucket` | `storage.tf` obcina nazwę (`substr` do 54 + losowy hex) |
| `account_id` service accounta > 30 znaków (i nie może kończyć się `-`) | `must be between 6 and 30 characters long` | `iam.tf`: `trimsuffix(substr(..., 0, 30), "-")` |
| `attempt_deadline` Cloud Schedulera > 30 min | `must be between 15s and 30m0s` mimo że `timeout_seconds` funkcji = 3600s | `scheduler.tf`: `min(var.timeout_seconds, 1800)` |
| Scheduler wołał bazowy URL funkcji zamiast `/scrape` | Cloud Scheduler log: `404 NOT_FOUND` | `scheduler.tf`: `uri = "${...url}/scrape"`, `audience` zostaje bazowym URL (wymóg OIDC na Cloud Run) |
| `nodejs20` deprecated (2026-04-30), decommission 2026-10-30 | ostrzeżenie w konsoli GCP | zmigrowano oba entry pointy na `nodejs24` |
| **Dwa różne poziomy uprawnień w tym samym projekcie** | `terraform apply` działa, ale interaktywny `gcloud` (to samo konto `mikolaj.chmielecki@consdata.com`) dostaje `PERMISSION_DENIED` na `cloudscheduler.jobs.run`, `cloudfunctions.functions.get`, `serviceusage.services.use` | Terraform używa Application Default Credentials — osobnych od tego, co widać w `gcloud auth list`. Faktycznym właścicielem `cloud-playground-mchmielecki` jest konto `chmielecki.mikolaj@gmail.com`. Przełącz: `gcloud config set account chmielecki.mikolaj@gmail.com` |
| `billing/quota_project` wskazywał na niepowiązany projekt (`cd-devops`) | `gcloud pubsub topics publish` → `PERMISSION_DENIED ... USER_PROJECT_DENIED` dla projektu `cd-devops`, nie tego z `--project` | `gcloud config unset billing/quota_project` (albo `--billing-project=<właściwy-projekt>` per komenda — ale to nie pomoże, jeśli i tak brakuje `serviceusage.services.use` na koncie) |

## Dlaczego brak dead-letter queue

Świadomie pominięte na tym etapie — patrz [architektura.md § Konsument → Firestore](./architektura.md).
Rewizja warta rozważenia, gdyby to miał być system współdzielony/produkcyjny z realnym SLA na
brak utraty wiadomości.

## Co dalej (nie zaimplementowane)

- Sentiment analysis nad artykułami w Firestore (obecnie tylko archiwizacja)
- Testy automatyczne
- Remote state backend dla Terraform (obecnie lokalny `terraform.tfstate`)
- Dedup globalny między zimnymi startami scrapera (patrz Ograniczenia w architektura.md)
