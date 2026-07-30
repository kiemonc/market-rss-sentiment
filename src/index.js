const express = require('express');
const config = require('./config');
const { initPubSub, publishArticle } = require('./pubsub');
const { scrapeAllFeeds } = require('./scraper');

const app = express();

app.use(express.json());

let isRunning = false;

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/scrape', async (req, res) => {
  if (isRunning) {
    return res.status(429).json({ error: 'Scrape already in progress' });
  }

  isRunning = true;
  res.status(202).json({ message: 'Scrape job started', status_url: '/scrape-status' });

  try {
    console.log(`\n=== Starting RSS scrape at ${new Date().toISOString()} ===`);
    console.log(`Configured feeds: ${config.rssFeeds.length}`);

    if (config.rssFeeds.length === 0) {
      console.warn('No RSS feeds configured in RSS_FEEDS environment variable.');
      isRunning = false;
      return;
    }

    const articles = await scrapeAllFeeds(config.rssFeeds);
    console.log(`\nTotal new articles fetched: ${articles.length}`);

    let published = 0;
    for (const article of articles) {
      const messageId = await publishArticle(article);
      if (messageId) {
        published++;
      }
    }

    console.log(`\n=== Scrape completed: ${published}/${articles.length} articles published ===\n`);
  } catch (err) {
    console.error('Scrape job failed:', err.message);
  } finally {
    isRunning = false;
  }
});

app.get('/scrape-status', (req, res) => {
  res.status(200).json({ running: isRunning, timestamp: new Date().toISOString() });
});

const PORT = config.port;

async function start() {
  try {
    console.log('Initializing Pub/Sub...');
    await initPubSub();
    console.log('Pub/Sub initialized successfully.');

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Health check: GET http://localhost:${PORT}/health`);
      console.log(`Trigger scrape: POST http://localhost:${PORT}/scrape`);
      console.log(`Check status: GET http://localhost:${PORT}/scrape-status`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
