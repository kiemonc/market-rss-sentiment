import express, { Request, Response } from 'express';
import { http } from '@google-cloud/functions-framework';
import config from './config';
import { createPublisher, Publisher } from './publishers';
import { scrapeAllFeeds } from './scraper';
import { resolveMultipleArticles } from './content-resolver';
// Side-effect import: registers 'consumeArticle' in the functions-framework
// registry. The framework always loads dist/index.js (package.json's main)
// regardless of which entry_point/FUNCTION_TARGET a given deployment uses, so
// the consumer's registration must happen here to be discoverable at all.
import './consumer';

const app = express();

app.use(express.json());

let isRunning = false;
let publisher: Publisher;
let publisherInit: Promise<Publisher> | null = null;

// Cloud Functions instances are ephemeral between invocations, so the publisher
// is created lazily on first request and reused by warm instances.
function getPublisher(): Promise<Publisher> {
  if (!publisherInit) {
    publisherInit = (async () => {
      publisher = createPublisher(config.publisherType, config);
      await publisher.initialize();
      return publisher;
    })();
  }
  return publisherInit;
}

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    publisher: config.publisherType,
  });
});

// Runs synchronously to completion before responding: Cloud Functions gives no
// guarantee that background work continues after a response is sent.
app.post('/scrape', async (req: Request, res: Response) => {
  if (isRunning) {
    return res.status(429).json({ error: 'Scrape already in progress' });
  }

  isRunning = true;

  try {
    console.log(`\n=== Starting RSS scrape at ${new Date().toISOString()} ===`);
    console.log(`Using publisher: ${config.publisherType}`);
    console.log(`Configured feeds: ${config.rssFeeds.length}`);

    if (config.rssFeeds.length === 0) {
      console.warn('No RSS feeds configured in RSS_FEEDS environment variable.');
      return res.status(200).json({ message: 'No RSS feeds configured', published: 0, total: 0 });
    }

    const activePublisher = await getPublisher();

    const articles = await scrapeAllFeeds(config.rssFeeds);
    console.log(`\nTotal new articles fetched: ${articles.length}`);

    // Resolve full content for each article
    const articlesWithContent = await resolveMultipleArticles(articles);

    let published = 0;
    for (const article of articlesWithContent) {
      const messageId = await activePublisher.publish(article);
      if (messageId) {
        published++;
      }
    }

    console.log(`\n=== Scrape completed: ${published}/${articlesWithContent.length} articles published ===\n`);
    res.status(200).json({ message: 'Scrape completed', published, total: articlesWithContent.length });
  } catch (err) {
    console.error('Scrape job failed:', (err as Error).message);
    res.status(500).json({ error: 'Scrape job failed', message: (err as Error).message });
  } finally {
    isRunning = false;
  }
});

app.get('/scrape-status', (req: Request, res: Response) => {
  res.status(200).json({ running: isRunning, timestamp: new Date().toISOString() });
});

// Registers `app` as the Cloud Functions (2nd gen) HTTP entry point.
// The functions-framework runtime owns the HTTP server on Cloud Functions;
// for local development, use `npm run dev` / `npm start` (see package.json).
http('app', app);

export { app };
