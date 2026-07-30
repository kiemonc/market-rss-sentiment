# Market RSS Sentiment Analyzer

RSS scraper for market news with pluggable publishers (Google Cloud Pub/Sub or local file).

## Features

- 🔄 RSS feed scraping with deduplication
- 📄 Full article content resolution (HTML parsing + text extraction)
- 📤 Pluggable publishers: Google Cloud Pub/Sub or local file
- 🌐 Express HTTP API for local + Cloud Run
- ⚙️ Environment-based configuration
- 🐳 Docker-ready for Cloud Run
- 📝 TypeScript with full type safety
- ⚡ Smart caching & rate limiting for content fetching

## Quick Start

### 1. Local Setup

```bash
./npm.sh install
```

(Or `npm install` if Node.js is in your PATH)

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env` with your RSS feeds (JSON format):

```env
RSS_FEEDS=[{"name":"bloomberg","url":"https://feeds.bloomberg.com/markets/news.rss"}]
GCP_PROJECT_ID=your-gcp-project
PUBSUB_TOPIC=market-articles
```

### 2. Build & Run

**Development (local file publisher):**

```bash
npm run build
npm start
# or with auto-rebuild:
npm run dev
```

Articles will be saved to `./articles/articles.jsonl` (JSONL format).

**Production (GCP Pub/Sub):**

```bash
PUBLISHER_TYPE=gcp npm start
```

Ensure `GCP_PROJECT_ID` and `PUBSUB_TOPIC` are set in `.env` or environment.

### 3. Trigger Scrape

```bash
curl -X POST http://localhost:8080/scrape
```

Check status:

```bash
curl http://localhost:8080/scrape-status
```

## Publishers

The app supports two publishers, selectable via `PUBLISHER_TYPE` environment variable:

### File Publisher (Development - Default)
Saves articles to JSONL file (one JSON per line) in `./articles/articles.jsonl`.

```bash
PUBLISHER_TYPE=file
ARTICLES_OUTPUT_DIR=./articles
```

Useful for local testing, CI/CD pipelines, or demos.

### Google Cloud Pub/Sub (Production)
Publishes articles to Google Cloud Pub/Sub topic for async processing.

```bash
PUBLISHER_TYPE=gcp
GCP_PROJECT_ID=your-gcp-project
PUBSUB_TOPIC=market-articles
```

Perfect for serverless architectures and cloud-native deployments.

- `GET /health` — Health check
- `POST /scrape` — Start RSS scraping (async)
- `GET /scrape-status` — Check if scrape is running

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | HTTP server port |
| `NODE_ENV` | development | Set to `production` for Cloud Run |
| `PUBLISHER_TYPE` | file (dev), gcp (prod) | Publisher: `file` or `gcp` |
| `ARTICLES_OUTPUT_DIR` | ./articles | Output directory for file publisher |
| `GCP_PROJECT_ID` | test-project | Google Cloud Project ID (for gcp publisher) |
| `PUBSUB_TOPIC` | market-articles | Pub/Sub topic name (for gcp publisher) |
| `RSS_FEEDS` | [] | JSON array of feed objects: `[{"name":"...", "url":"..."}]` |
| `PUBSUB_EMULATOR_HOST` | (empty) | For local testing with Pub/Sub emulator: `localhost:8085` |

## Cloud Run Deployment

### Prerequisites

- Google Cloud Project with Cloud Run enabled
- Create Pub/Sub topic: `gcloud pubsub topics create market-articles`

### Build & Deploy

```bash
# Build image
docker build -t gcr.io/YOUR_PROJECT/market-rss-sentiment .

# Push to Container Registry
docker push gcr.io/YOUR_PROJECT/market-rss-sentiment

# Deploy to Cloud Run
gcloud run deploy market-rss-sentiment \
  --image gcr.io/YOUR_PROJECT/market-rss-sentiment \
  --platform managed \
  --region us-central1 \
  --memory 512Mi \
  --timeout 3600 \
  --set-env-vars GCP_PROJECT_ID=YOUR_PROJECT,PUBSUB_TOPIC=market-articles,RSS_FEEDS='[{"name":"cnbc","url":"https://www.cnbc.com/id/100003114/device/rss/rss.html"}]'
```

### Schedule Scrapes

Use Cloud Scheduler to trigger `/scrape` endpoint:

```bash
gcloud scheduler jobs create http scrape-market-news \
  --location=us-central1 \
  --schedule="0 */6 * * *" \
  --uri=https://YOUR_SERVICE_URL/scrape \
  --http-method=POST \
  --oidc-service-account-email=YOUR_SERVICE_ACCOUNT
```

## Local Development with Pub/Sub Emulator

Start the emulator:

```bash
gcloud beta emulators pubsub start --host-port=localhost:8085
```

In another terminal:

```bash
export PUBSUB_EMULATOR_HOST=localhost:8085
npm start
```

## Architecture

```
RSS Feeds → Scraper → Deduplication → Pub/Sub Topic → Subscribers
```

- **Scraper** fetches RSS feeds concurrently
- **Deduplication** uses MD5 hash of title+link to avoid duplicates
- **Pub/Sub** decouples scraping from processing (sentiment analysis, storage, etc.)

Link do diagramu architektury: https://app.diagrams.net/#Hkiemonc%2Fmarket-rss-sentiment%2Fmain%2Farchitecture.drawio