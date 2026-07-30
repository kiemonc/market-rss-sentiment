import express, { Request, Response } from 'express';
import config from './config';
import { createPublisher, Publisher } from './publishers';
import { scrapeAllFeeds } from './scraper';
import { resolveMultipleArticles } from './content-resolver';

const app = express();

app.use(express.json());

let isRunning = false;
let publisher: Publisher;

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    publisher: config.publisherType,
  });
});

app.post('/scrape', async (req: Request, res: Response) => {
  if (isRunning) {
    return res.status(429).json({ error: 'Scrape already in progress' });
  }

  isRunning = true;
  res.status(202).json({ message: 'Scrape job started', status_url: '/scrape-status' });

  try {
    console.log(`\n=== Starting RSS scrape at ${new Date().toISOString()} ===`);
    console.log(`Using publisher: ${config.publisherType}`);
    console.log(`Configured feeds: ${config.rssFeeds.length}`);

    if (config.rssFeeds.length === 0) {
      console.warn('No RSS feeds configured in RSS_FEEDS environment variable.');
      isRunning = false;
      return;
    }

    const articles = await scrapeAllFeeds(config.rssFeeds);
    console.log(`\nTotal new articles fetched: ${articles.length}`);

    // Resolve full content for each article
    const articlesWithContent = await resolveMultipleArticles(articles);

    let published = 0;
    for (const article of articlesWithContent) {
      const messageId = await publisher.publish(article);
      if (messageId) {
        published++;
      }
    }

    console.log(`\n=== Scrape completed: ${published}/${articlesWithContent.length} articles published ===\n`);
  } catch (err) {
    console.error('Scrape job failed:', (err as Error).message);
  } finally {
    isRunning = false;
  }
});

app.get('/scrape-status', (req: Request, res: Response) => {
  res.status(200).json({ running: isRunning, timestamp: new Date().toISOString() });
});

const PORT = config.port;

async function start(): Promise<void> {
  try {
    console.log(`\n🚀 Starting Market RSS Sentiment (${config.publisherType} publisher)`);

    publisher = createPublisher(config.publisherType, config);
    await publisher.initialize();

    app.listen(PORT, () => {
      console.log(`\n✓ Server running on http://localhost:${PORT}`);
      console.log(`  GET  http://localhost:${PORT}/health`);
      console.log(`  POST http://localhost:${PORT}/scrape`);
      console.log(`  GET  http://localhost:${PORT}/scrape-status\n`);
    });
  } catch (err) {
    console.error('Failed to start server:', (err as Error).message);
    process.exit(1);
  }
}

start();
