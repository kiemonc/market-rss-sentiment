import FeedParser from 'feedparser';
import fetch, { Response } from 'node-fetch';
import crypto from 'crypto';
import { Article } from './pubsub';

const seenArticleIds = new Set<string>();

function generateArticleId(title: string, link: string): string {
  const content = `${title}:${link}`;
  return crypto.createHash('md5').update(content).digest('hex');
}

async function fetchRssFeed(feedUrl: string, sourceName: string): Promise<Article[]> {
  return new Promise((resolve, reject) => {
    const articles: Article[] = [];
    const parser = new FeedParser();

    parser.on('error', (error: Error) => {
      console.error(`Parser error for ${sourceName} (${feedUrl}):`, error.message);
      reject(error);
    });

    parser.on('readable', function (this: FeedParser) {
      let item;
      while ((item = this.read())) {
        const title = item.title || 'No title';
        const link = item.link || '';
        const articleId = generateArticleId(title, link);

        if (!seenArticleIds.has(articleId)) {
          seenArticleIds.add(articleId);
          const pubDate = item.pubDate || item.date || new Date().toISOString();
          const parsedPubDate = new Date(pubDate);
          articles.push({
            id: articleId,
            title,
            link,
            description: item.description || item.summary || '',
            source: sourceName,
            pubDate,
            publishedAt: (isNaN(parsedPubDate.getTime()) ? new Date() : parsedPubDate).toISOString(),
          });
        }
      }
    });

    parser.on('end', () => {
      resolve(articles);
    });

    fetch(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })
      .then((res: Response) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        (res.body as any).pipe(parser);
      })
      .catch((err: Error) => {
        console.error(`Fetch error for ${sourceName} (${feedUrl}):`, err.message);
        reject(err);
      });
  });
}

async function scrapeAllFeeds(feeds: Array<{ name: string; url: string }>): Promise<Article[]> {
  const allArticles: Article[] = [];

  for (const feed of feeds) {
    try {
      console.log(`Fetching RSS from ${feed.name}: ${feed.url}`);
      const articles = await fetchRssFeed(feed.url, feed.name);
      allArticles.push(...articles);
      console.log(`  → Found ${articles.length} new articles from ${feed.name}`);
    } catch (err) {
      console.error(`Error scraping ${feed.name}:`, (err as Error).message);
    }
  }

  return allArticles;
}

export { scrapeAllFeeds };
