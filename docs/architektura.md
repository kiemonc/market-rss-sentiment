# Architektura

## Przepływ danych

```
RSS Feeds ──► Scraper (Cloud Function "app", HTTP)
                 │
                 ├─ dedup po MD5(title:link) [w pamięci procesu]
                 ├─ pobranie pełnej treści artykułu (HTML → tekst)
                 └─ publikacja do Pub/Sub
                        │
                        ▼
              Topic "market-articles"
                        │
                        ▼
        Consumer (Cloud Function "consumeArticle", trigger Eventarc)
                        │
                        └─ upsert do Firestore: articles/{id}
```

Wyzwalanie: Cloud Scheduler POSTuje na `/scrape` co 6h (`0 */6 * * *`, UTC). Sam `/scrape`
działa **synchronicznie do końca** (nie fire-and-forget) — Cloud Functions nie gwarantuje
kontynuacji pracy w tle po wysłaniu odpowiedzi, więc cały scrape musi się zmieścić w
`timeout_seconds` (patrz [infrastruktura.md](./infrastruktura.md)).

## Mapa kodu

| Plik | Rola |
|---|---|
| `src/index.ts` | Express app = funkcja HTTP `app` (`/health`, `/scrape`, `/scrape-status`); rejestruje się w functions-framework przez `http('app', app)`; importuje `./consumer` dla efektu ubocznego (patrz niżej) |
| `src/scraper.ts` | Pobiera RSS-y (`feedparser`), dedup po `MD5(title:link)` w `Set` trzymanym w pamięci procesu (dedup **per-instancja**, nie globalny — patrz Ograniczenia) |
| `src/content-resolver.ts` | Dla każdego artykułu pobiera pełną treść HTML i wyciąga tekst (`cheerio`, kilka selektorów kandydatów), z prostym cache'em w pamięci i rate-limitem 500ms między requestami |
| `src/pubsub.ts` | Definicje typów: `Article` → `ArticleWithContent` → `ArticlePayload` (dokładny kształt wiadomości publikowanej do Pub/Sub) |
| `src/publishers/` | Abstrakcja `Publisher` (`initialize`, `publish`, `close?`) z dwiema implementacjami: `GoogleCloudPublisher` (Pub/Sub, produkcja) i `FilePublisher` (JSONL per-feed, lokalny dev) — wybór przez `PUBLISHER_TYPE` |
| `src/consumer.ts` | Funkcja `consumeArticle` (Eventarc/Pub/Sub trigger) — dekoduje wiadomość, zapisuje do Firestore |
| `src/config.ts` | Czyta wszystkie zmienne środowiskowe w jednym miejscu |

## Kontrakt danych (Pub/Sub payload)

To, co faktycznie leci na topic (budowane ręcznie pole-po-polu w `google-cloud.publisher.ts`,
nie przez spread — to jest **jedyne** miejsce definiujące realny format wiadomości):

```ts
{
  id: string,              // MD5(title + ":" + link) — używany też jako Firestore doc ID
  title: string,
  link: string,
  description: string,
  content: string,         // pełna treść wyciągnięta z HTML (do 5000 znaków)
  source: string,           // nazwa feedu, np. "bloomberg"
  pubDate: string,
  contentFetchedAt?: string,
  fetchedAt: string,        // ISO timestamp nadany w momencie publikacji
}
```

## Konsument → Firestore

`src/consumer.ts` rejestruje handler przez `cloudEvent('consumeArticle', ...)`. Kluczowy,
nieoczywisty szczegół: **musi być zaimportowany w `src/index.ts`** (`import './consumer'`),
bo functions-framework zawsze ładuje `dist/index.js` (pole `main` z `package.json`)
niezależnie od tego, który `entry_point`/`FUNCTION_TARGET` jest wdrażany — rejestracja
(`http()`/`cloudEvent()`) trafia do wspólnego rejestru w pamięci, dopiero framework wybiera
z niego właściwą funkcję. Bez tego importu `consumeArticle` nigdy by się nie zarejestrował.

Logika błędów w handlerze (rozróżnienie na poziomie kodu, nie samego `retry_policy`):

- **Błąd trwały** (nie da się zparsować base64/JSON, brak `id`) → log + `return` bez `throw`.
  Pub/Sub ackuje wiadomość, nie retry'uje — i tak nigdy by się nie sparsowała.
- **Błąd przejściowy** (Firestore write rzuca wyjątek) → log + `throw`. Pub/Sub retry'uje
  zgodnie z `retry_policy` (domyślnie `RETRY_POLICY_RETRY`), ograniczone retencją topicu
  (domyślnie 7 dni).
- Zapis to `set(payload, { merge: true })` na `articles/{id}` — idempotentne, redelivery
  nadpisuje ten sam dokument zamiast tworzyć duplikat.
- **Brak dead-letter topicu** — świadoma decyzja: przy tej skali projektu (kilka feedów RSS)
  DLQ to dodatkowy topic/subskrypcja/IAM i proces triażu, którego i tak nikt by nie
  obsługiwał; logi + powyższy podział wystarczają. Do rewizji, gdyby to miał być
  współdzielony/produkcyjny system.

## Ograniczenia obecnego stanu

- **Dedup jest per-instancja procesu**, nie globalny — `seenArticleIds` w `scraper.ts` żyje
  w pamięci jednej instancji Cloud Function. Przy `min_instance_count = 0` (scale-to-zero)
  każde nowe zimne uruchomienie zaczyna z pustym zbiorem, więc realny dedup na dłuższą metę
  opiera się głównie na tym, że ten sam RSS feed zwykle nie publikuje ponownie starych wpisów —
  nie na tym mechanizmie. Firestore z kolei dedupuje poprawnie i trwale, bo doc ID = `id`.
- Sentiment analysis (wspomniany w opisie projektu i `architecture.drawio`) **nie jest
  zaimplementowany** — obecny konsument tylko archiwizuje artykuły do Firestore.
- `FilePublisher` (tryb `file`) nie jest używany w żadnym wdrożeniu na GCP — istnieje tylko
  do lokalnego dev/demo.
