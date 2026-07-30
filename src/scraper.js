const FeedParser = require('feedparser');
const fetch = require('node-fetch');
const crypto = require('crypto');

const seenArticleIds = new Set();

function generateArticleId(title, link) {
  const content = `${title}:${link}`;
  return crypto.createHash('md5').update(content).digest('hex');
}

async function fetchRssFeed(feedUrl, sourceName) {
  return new Promise((resolve, reject) => {
    const articles = [];
    const parser = new FeedParser();

    parser.on('error', (error) => {
      console.error(`Parser error for ${sourceName} (${feedUrl}):`, error.message);
      reject(error);
    });

    parser.on('readable', function () {
      let item;
      while ((item = this.read())) {
        const articleId = generateArticleId(item.title, item.link);

        if (!seenArticleIds.has(articleId)) {
          seenArticleIds.add(articleId);
          articles.push({
            id: articleId,
            title: item.title || 'No title',
            link: item.link || '',
            description: item.description || item.summary || '',
            source: sourceName,
            pubDate: item.pubDate || item.date || new Date().toISOString(),
          });
        }
      }
    });

    parser.on('end', () => {
      resolve(articles);
    });

    fetch(feedUrl)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        res.body.pipe(parser);
      })
      .catch((err) => {
        console.error(`Fetch error for ${sourceName} (${feedUrl}):`, err.message);
        reject(err);
      });
  });
}

async function scrapeAllFeeds(feeds) {
  const allArticles = [];

  for (const feed of feeds) {
    try {
      console.log(`Fetching RSS from ${feed.name}: ${feed.url}`);
      const articles = await fetchRssFeed(feed.url, feed.name);
      allArticles.push(...articles);
      console.log(`  → Found ${articles.length} new articles from ${feed.name}`);
    } catch (err) {
      console.error(`Error scraping ${feed.name}:`, err.message);
    }
  }

  return allArticles;
}

module.exports = {
  scrapeAllFeeds,
};
