# Operacje

## Wdrożenie / redeploy

Stan Terraform jest przechowywany zdalnie w GCS (bucket `<project_id>-tfstate`,
utworzony poza Terraformem — patrz "Remote state" poniżej), więc przed pierwszym
`init` w danym środowisku trzeba skonfigurować backend:

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars   # tylko za pierwszym razem
cp backend.hcl.example backend.hcl             # tylko za pierwszym razem
# edytuj terraform.tfvars: project_id, rss_feeds, schedule, ...
# edytuj backend.hcl: bucket = "<project_id>-tfstate"

terraform init -backend-config=backend.hcl
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

## Remote state (GCS)

Stan Terraform leży w `gs://<project_id>-tfstate/terraform/state/default.tfstate`
(backend `gcs`, skonfigurowany w `versions.tf` + `backend.hcl` — patrz wyżej).

- **Bucket tworzony jest ręcznie, nie przez ten sam Terraform**, żeby `terraform
  destroy` nie mógł usunąć bucketa przechowującego własny stan:
  ```bash
  gcloud storage buckets create gs://<project_id>-tfstate \
    --project=<project_id> --location=us-central1 \
    --uniform-bucket-level-access --public-access-prevention
  gcloud storage buckets update gs://<project_id>-tfstate --versioning
  ```
- Wersjonowanie bucketa jest włączone — poprzednie wersje `default.tfstate`
  zostają, gdyby trzeba było się do nich wrócić.
- Locking jest wbudowany w backend `gcs` (przez generation precondition na
  obiekcie) — nie trzeba dodatkowej konfiguracji DynamoDB-jak-w-AWS.
- `backend.hcl` jest w `.gitignore` (nazwa bucketa jest projekt-specyficzna,
  tak jak `terraform.tfvars`) — skopiuj z `backend.hcl.example`.
- Migracja z lokalnego stanu do tego backendu (`terraform init
  -backend-config=backend.hcl -migrate-state`) została wykonana 2026-08-25;
  lokalne `terraform.tfstate`/`.backup` zostały po tym usunięte.

## Dlaczego brak dead-letter queue

Świadomie pominięte na tym etapie — patrz [architektura.md § Konsument → Firestore](./architektura.md).
Rewizja warta rozważenia, gdyby to miał być system współdzielony/produkcyjny z realnym SLA na
brak utraty wiadomości.

## Testy automatyczne

```bash
npm test          # jednorazowo (vitest run)
npm run test:watch
```

Vitest, tylko testy jednostkowe (bez sieci/GCP — `node-fetch`, `@google-cloud/pubsub`,
`@google-cloud/firestore` zamockowane). 47 testów pokrywających: scraper (parsowanie RSS,
dedup, obsługa błędów per-feed), content-resolver (selektory HTML, cache, fallback),
oba publishery, `createPublisher`, config (parsowanie env), konsument (wszystkie ścieżki
błędów + idempotencja) i endpointy Express w `src/index.ts` (przez `supertest`, włącznie
z odrzuceniem współbieżnego `/scrape` kodem 429). Pliki testowe leżą obok kodu
(`src/**/*.test.ts`) i są wykluczone z `tsconfig.json` `exclude`, więc nie trafiają do
`dist/`/wdrożenia.

## Co dalej (nie zaimplementowane)

- Sentiment analysis nad artykułami w Firestore (obecnie tylko archiwizacja)
- Testy integracyjne na emulatorach (Pub/Sub + Firestore) — świadomie pominięte na razie,
  obecne testy jednostkowe wystarczają na tym etapie
- Dedup globalny między zimnymi startami scrapera (patrz Ograniczenia w architektura.md)
