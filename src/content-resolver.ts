import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import type { Article, ArticleWithContent } from './pubsub';

// Simple in-memory cache to avoid fetching same content twice
const contentCache = new Map<string, string>();

// Rate limiter: delay between requests in ms
const FETCH_DELAY_MS = 500;
let lastFetchTime = 0;

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAndParseContent(link: string): Promise<string | null> {
  if (!link) return null;

  // Check cache first
  if (contentCache.has(link)) {
    console.log(`  ℹ️  Using cached content for: ${link.substring(0, 50)}...`);
    return contentCache.get(link)!;
  }

  try {
    // Rate limiting
    const timeSinceLastFetch = Date.now() - lastFetchTime;
    if (timeSinceLastFetch < FETCH_DELAY_MS) {
      await delay(FETCH_DELAY_MS - timeSinceLastFetch);
    }
    lastFetchTime = Date.now();

    const response = await fetch(link, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      console.warn(`  ⚠️  Failed to fetch content (HTTP ${response.status}): ${link.substring(0, 50)}...`);
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Try common article content selectors
    let content = '';

    // Remove unwanted elements
    $('script, style, nav, footer, .ad, .advertisement, .sidebar').remove();

    // Try multiple selectors for article content
    const selectors = [
      'article',
      '[role="main"]',
      '.article-content',
      '.post-content',
      '.entry-content',
      '.content',
      'main',
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        content = element.text().trim();
        if (content.length > 100) break;
      }
    }

    // If no article content found, get all text
    if (content.length < 100) {
      content = $('body').text().trim();
    }

    // Clean up whitespace
    content = content
      .replace(/\s+/g, ' ')
      .substring(0, 5000) // Limit to 5000 chars
      .trim();

    if (content.length === 0) {
      console.warn(`  ⚠️  No content extracted from: ${link.substring(0, 50)}...`);
      return null;
    }

    // Cache it
    contentCache.set(link, content);
    console.log(`  ✓ Fetched ${content.length} chars from: ${link.substring(0, 50)}...`);

    return content;
  } catch (err) {
    console.warn(`  ⚠️  Error fetching content: ${(err as Error).message}`);
    return null;
  }
}

async function resolveArticleContent(article: Article): Promise<ArticleWithContent> {
  const content = await fetchAndParseContent(article.link);

  return {
    ...article,
    content: content || '',
    contentFetchedAt: new Date().toISOString(),
  };
}

async function resolveMultipleArticles(articles: Article[]): Promise<ArticleWithContent[]> {
  console.log(`\nFetching full content for ${articles.length} articles...`);

  const resolved: ArticleWithContent[] = [];

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    console.log(`[${i + 1}/${articles.length}] Resolving: ${article.title.substring(0, 50)}...`);

    const resolved_article = await resolveArticleContent(article);
    resolved.push(resolved_article);
  }

  console.log(`✓ Resolved ${resolved.length} articles with content`);
  return resolved;
}

export { fetchAndParseContent, resolveArticleContent, resolveMultipleArticles };
export type { ArticleWithContent };
