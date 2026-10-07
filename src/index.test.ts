import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const mockConfig = vi.hoisted(() => ({
  port: 8080,
  nodeEnv: 'test',
  publisherType: 'file' as 'gcp' | 'file',
  gcp: { projectId: 'p', pubsubTopic: 't' },
  filePublisher: { outputDir: './articles' },
  rssFeeds: [] as Array<{ name: string; url: string }>,
  pubsubEmulatorHost: null as string | null,
}));
vi.mock('./config', () => ({ default: mockConfig }));

const { mockInitialize, mockPublish, mockCreatePublisher } = vi.hoisted(() => {
  const mockInitialize = vi.fn().mockResolvedValue(undefined);
  const mockPublish = vi.fn();
  const mockCreatePublisher = vi.fn(() => ({ initialize: mockInitialize, publish: mockPublish }));
  return { mockInitialize, mockPublish, mockCreatePublisher };
});
vi.mock('./publishers', () => ({ createPublisher: mockCreatePublisher }));

const mockScrapeAllFeeds = vi.hoisted(() => vi.fn());
vi.mock('./scraper', () => ({ scrapeAllFeeds: mockScrapeAllFeeds }));

const mockResolveMultipleArticles = vi.hoisted(() => vi.fn());
vi.mock('./content-resolver', () => ({ resolveMultipleArticles: mockResolveMultipleArticles }));

// Passthrough: the Firestore-backed "already stored" filter has its own tests.
const mockFilterUnseenArticles = vi.hoisted(() => vi.fn(async (articles: unknown[]) => articles));
vi.mock('./known-articles', () => ({ filterUnseenArticles: mockFilterUnseenArticles }));

// Not under test here, and importing it for real would pull in
// @google-cloud/firestore for no reason.
vi.mock('./consumer', () => ({}));
// Same reasoning, plus it would pull in @google/genai.
vi.mock('./sentiment-consumer', () => ({}));
vi.mock('@google-cloud/functions-framework', () => ({ http: vi.fn() }));

import { app } from './index';

beforeEach(() => {
  mockConfig.publisherType = 'file';
  mockConfig.rssFeeds = [];
  mockScrapeAllFeeds.mockReset();
  mockResolveMultipleArticles.mockReset();
  mockPublish.mockReset();
});

describe('GET /health', () => {
  it('reports ok status and the configured publisher type', async () => {
    mockConfig.publisherType = 'gcp';

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', publisher: 'gcp' });
    expect(typeof res.body.timestamp).toBe('string');
  });
});

describe('GET /scrape-status', () => {
  it('reports not running when no scrape has started', async () => {
    const res = await request(app).get('/scrape-status');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ running: false });
  });
});

describe('POST /scrape', () => {
  it('returns 200 with zero counts and does not scrape when no feeds are configured', async () => {
    mockConfig.rssFeeds = [];

    const res = await request(app).post('/scrape');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: 'No RSS feeds configured', published: 0, total: 0 });
    expect(mockScrapeAllFeeds).not.toHaveBeenCalled();
  });

  it('scrapes, resolves content, and publishes every article on the happy path', async () => {
    mockConfig.rssFeeds = [{ name: 'bloomberg', url: 'https://example.com/rss' }];
    mockScrapeAllFeeds.mockResolvedValueOnce([{ id: '1' }]);
    mockResolveMultipleArticles.mockResolvedValueOnce([{ id: '1', content: 'c' }]);
    mockPublish.mockResolvedValueOnce('message-id-1');

    const res = await request(app).post('/scrape');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: 'Scrape completed', published: 1, total: 1 });
    expect(mockPublish).toHaveBeenCalledWith({ id: '1', content: 'c' });
  });

  it('counts only successfully published articles', async () => {
    mockConfig.rssFeeds = [{ name: 'bloomberg', url: 'https://example.com/rss' }];
    mockScrapeAllFeeds.mockResolvedValueOnce([{ id: '1' }, { id: '2' }]);
    mockResolveMultipleArticles.mockResolvedValueOnce([{ id: '1' }, { id: '2' }]);
    mockPublish.mockResolvedValueOnce('message-id-1').mockResolvedValueOnce(null);

    const res = await request(app).post('/scrape');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: 'Scrape completed', published: 1, total: 2 });
  });

  it('returns 500 and resets the running flag when scraping fails', async () => {
    mockConfig.rssFeeds = [{ name: 'bloomberg', url: 'https://example.com/rss' }];
    mockScrapeAllFeeds.mockRejectedValueOnce(new Error('scrape boom'));

    const res = await request(app).post('/scrape');

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'Scrape job failed', message: 'scrape boom' });

    const status = await request(app).get('/scrape-status');
    expect(status.body.running).toBe(false);
  });

  it('rejects a concurrent scrape with 429 while one is already in progress', async () => {
    mockConfig.rssFeeds = [{ name: 'bloomberg', url: 'https://example.com/rss' }];

    let releaseFirstScrape!: (articles: unknown[]) => void;
    let signalStarted!: () => void;
    const scrapeStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    mockScrapeAllFeeds.mockImplementationOnce(() => {
      // isRunning is flipped to true before scrapeAllFeeds is called, so this
      // is the earliest safe point to fire the second, concurrent request.
      signalStarted();
      return new Promise((resolve) => {
        releaseFirstScrape = resolve;
      });
    });
    mockResolveMultipleArticles.mockResolvedValueOnce([]);

    // supertest/superagent requests are lazy — nothing is actually sent until
    // `.then()` (i.e. `await`) is called on them — so kick this one off now
    // via an explicit `.then()` instead of awaiting it immediately.
    const firstRequest = request(app)
      .post('/scrape')
      .then((res) => res);
    await scrapeStarted;

    const secondResponse = await request(app).post('/scrape');
    expect(secondResponse.status).toBe(429);

    releaseFirstScrape([]);
    const firstResponse = await firstRequest;
    expect(firstResponse.status).toBe(200);
  });
});
