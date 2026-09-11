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
                        │
                        ▼
   Sentiment consumer (Cloud Function "analyzeArticleSentiment", trigger Eventarc)
                        │
                        ├─ artykuł → LLM (Vertex AI, Gemini) → mapa COIN -> {vector, weight, sentimentDiff}
                        └─ upsert do Firestore: sentiment/{articleId}
```

`consumeArticle` i `analyzeArticleSentiment` mają **osobne** Eventarc-owe subskrypcje na tym
samym topicu `market-articles` — każdy artykuł trafia do obu konsumentów niezależnie, nie w
łańcuchu.

Wyzwalanie: Cloud Scheduler POSTuje na `/scrape` co 6h (`0 */6 * * *`, UTC). Sam `/scrape`
działa **synchronicznie do końca** (nie fire-and-forget) — Cloud Functions nie gwarantuje
kontynuacji pracy w tle po wysłaniu odpowiedzi, więc cały scrape musi się zmieścić w
`timeout_seconds` (patrz [infrastruktura.md](./infrastruktura.md)).

## Mapa kodu

| Plik | Rola |
|---|---|
| `src/index.ts` | Express app = funkcja HTTP `app` (`/health`, `/scrape`, `/scrape-status`); rejestruje się w functions-framework przez `http('app', app)`; importuje `./consumer` dla efektu ubocznego (patrz niżej) |
| `src/scraper.ts` | Pobiera RSS-y (`feedparser`), dedup po `MD5(title:link)` w `Set` trzymanym w pamięci procesu (dedup **per-instancja**, nie globalny — patrz Ograniczenia) |
| `src/content-resolver.ts` | Dla każdego artykułu pobiera pełną treść HTML i wyciąga tekst — najpierw przez dedykowany parser danego źródła (`site-parsers.ts`), z fallbackiem do kilku generycznych selektorów-kandydatów gdy źródło go nie ma lub selektor przestał pasować — z prostym cache'em w pamięci i rate-limitem 500ms między requestami |
| `src/site-parsers.ts` | Selektory CSS dla ciała artykułu per-źródło RSS (`cointelegraph`, `decrypt`, `bitcoinmagazine`, `cryptoslate`, `newsbtc`), wyznaczone ręcznie z realnych stron; generyczne wielo-selektorowe zgadywanie w `content-resolver.ts` często łapało nav/related-articles/newsletter, stąd dedykowane parsery per motyw/framework strony |
| `src/pubsub.ts` | Definicje typów: `Article` → `ArticleWithContent` → `ArticlePayload` (dokładny kształt wiadomości publikowanej do Pub/Sub) |
| `src/publishers/` | Abstrakcja `Publisher` (`initialize`, `publish`, `close?`) z dwiema implementacjami: `GoogleCloudPublisher` (Pub/Sub, produkcja) i `FilePublisher` (JSONL per-feed, lokalny dev) — wybór przez `PUBLISHER_TYPE` |
| `src/consumer.ts` | Funkcja `consumeArticle` (Eventarc/Pub/Sub trigger) — dekoduje wiadomość, zapisuje do Firestore |
| `src/sentiment-analyzer.ts` | `analyzeArticleSentiment()` — wywołuje Vertex AI (Gemini, `@google/genai`, `responseSchema` wymuszający JSON) i zamienia odpowiedź na `SentimentAnalysis` (mapa ticker → `{vector, weight, sentimentDiff}`) |
| `src/sentiment-consumer.ts` | Funkcja `analyzeArticleSentiment` (Eventarc/Pub/Sub trigger, osobna subskrypcja tego samego topicu co `consumeArticle`) — dekoduje wiadomość, woła `sentiment-analyzer.ts`, zapisuje wynik do Firestore |
| `src/sentiment.ts` | Typy `CoinSentiment` / `SentimentAnalysis` |
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
  content: string,         // pełna treść wyciągnięta z HTML (do 50000 znaków)
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

## Sentiment consumer → Vertex AI → Firestore

`src/sentiment-consumer.ts` rejestruje handler `analyzeArticleSentiment` przez `cloudEvent(...)`,
zaimportowany w `src/index.ts` z tego samego powodu co `./consumer` (patrz wyżej).

Dla każdej wiadomości (ten sam `ArticlePayload` co konsument Firestore, ale przetwarzany
niezależnie — osobna subskrypcja tego samego topicu):

1. `src/sentiment-analyzer.ts` woła Vertex AI (`@google/genai`, `vertexai: true`, model z
   `VERTEX_AI_MODEL`/`config.vertexAi.model`, domyślnie `gemini-2.5-flash-lite` — tańszy niż
   `gemini-2.5-flash`, wystarczający do tego prostego, strukturalnego zadania ekstrakcji) z
   promptem proszącym o zidentyfikowanie każdej wspomnianej kryptowaluty; wymusza JSON przez
   `responseSchema` (`responseMimeType: 'application/json'`), żeby nie trzeba było parsować
   wolnego tekstu. `thinkingConfig: { thinkingBudget: 0 }` wyłącza dynamiczne "myślenie" modelu —
   bez tego 2.5-owe modele domyślnie generują niewidoczne tokeny rozumowania rozliczane jak
   output, zbędne dla zadania bez wieloetapowego wnioskowania.
2. Odpowiedź (tablica `{coin, vector, weight, sentimentDiff}`) jest zamieniana na
   `SentimentAnalysis` — mapę ticker (uppercase) → `CoinSentiment`:
   - `vector`: `[bullish, bearish, neutral]`, confidence w `[0,1]`, sumujące się w przybliżeniu do 1
   - `weight`: jak istotna/eksponowana jest dana moneta w artykule, `[0,1]`
   - `sentimentDiff`: podpisany wpływ artykułu na sentyment inwestorów wobec danej monety,
     `[-1,1]` — dodatnia wartość = pozytywny, ujemna = negatywny (czysta funkcja tego jednego
     artykułu, bez odczytu wcześniejszego stanu z Firestore)
3. Wynik trafia do `sentiment/{articleId}` (`config.sentimentCollection`, domyślnie `sentiment`)
   jako `set({articleId, source, analyzedAt, coins}, {merge: true})` — idempotentne jak przy
   konsumencie Firestore.

Ta sama logika trwały/przejściowy błąd co w `consumer.ts`: niesparsowalna wiadomość Pub/Sub lub
brak `id` → log + `return` (bez retry); błąd wywołania Vertex AI (w tym niepoprawny JSON w
odpowiedzi — retry może akurat zwrócić poprawny wynik) albo błąd zapisu do Firestore → log +
`throw` (Pub/Sub retry'uje).

## Ograniczenia obecnego stanu

- **Dedup jest per-instancja procesu**, nie globalny — `seenArticleIds` w `scraper.ts` żyje
  w pamięci jednej instancji Cloud Function. Przy `min_instance_count = 0` (scale-to-zero)
  każde nowe zimne uruchomienie zaczyna z pustym zbiorem, więc realny dedup na dłuższą metę
  opiera się głównie na tym, że ten sam RSS feed zwykle nie publikuje ponownie starych wpisów —
  nie na tym mechanizmie. Firestore z kolei dedupuje poprawnie i trwale, bo doc ID = `id`.
- `FilePublisher` (tryb `file`) nie jest używany w żadnym wdrożeniu na GCP — istnieje tylko
  do lokalnego dev/demo.
