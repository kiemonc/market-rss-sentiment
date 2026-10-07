# Dokumentacja — market-rss-sentiment

Dokumentacja aktualnego stanu projektu (stan na 2026-08-24, po wdrożeniu konsumenta Firestore).
Kod źródłowy i `terraform/*.tf` są źródłem prawdy — te dokumenty opisują *dlaczego* i *jak to działa razem*,
nie duplikują tego, co już widać w kodzie.

- [`architektura.md`](./architektura.md) — co robi system, przepływ danych, mapa kodu
- [`infrastruktura.md`](./infrastruktura.md) — co dokładnie stoi w GCP, zmienne Terraform, IAM
- [`operacje.md`](./operacje.md) — jak wdrażać, testować ręcznie, znane pułapki i ich obejścia

## Skrót jednym zdaniem

RSS → scraper (Cloud Function `market-rss-sentiment`, HTTP, wyzwalany co 30 min przez Cloud Scheduler) →
dedup + pobranie pełnej treści → Pub/Sub (`market-articles`) → konsument (Cloud Function
`market-rss-sentiment-consumer`, trigger Eventarc) → Firestore (`articles/{id}`).
