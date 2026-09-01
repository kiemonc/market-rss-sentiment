import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';

const mockFetch = vi.hoisted(() => vi.fn());
vi.mock('node-fetch', () => ({ default: mockFetch }));

function rssXml(items: Array<{ title: string; link: string; description: string; pubDate: string }>) {
  const itemsXml = items
    .map(
      (i) => `<item>
        <title>${i.title}</title>
        <link>${i.link}</link>
        <description>${i.description}</description>
        <pubDate>${i.pubDate}</pubDate>
      </item>`
    )
    .join('\n');

  return `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Test Feed</title>
  <link>https://example.com</link>
  <description>Test feed description</description>
  ${itemsXml}
</channel></rss>`;
}

function okResponse(xml: string) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body: Readable.from(Buffer.from(xml, 'utf-8')),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.resetModules();
});

describe('scrapeAllFeeds', () => {
  it('parses items from an RSS feed into articles', async () => {
    const xml = rssXml([
      { title: 'Article One', link: 'https://example.com/one', description: 'First', pubDate: 'Mon, 01 Jan 2024 00:00:00 GMT' },
      { title: 'Article Two', link: 'https://example.com/two', description: 'Second', pubDate: 'Tue, 02 Jan 2024 00:00:00 GMT' },
    ]);
    mockFetch.mockResolvedValueOnce(okResponse(xml));

    const { scrapeAllFeeds } = await import('./scraper');
    const articles = await scrapeAllFeeds([{ name: 'testfeed', url: 'https://example.com/rss' }]);

    expect(articles).toHaveLength(2);
    expect(articles[0]).toMatchObject({
      title: 'Article One',
      link: 'https://example.com/one',
      description: 'First',
      source: 'testfeed',
    });
    expect(articles[0].id).toMatch(/^[a-f0-9]{32}$/);
    expect(articles[1]).toMatchObject({ title: 'Article Two', link: 'https://example.com/two' });
  });

  it('strips HTML markup out of the description, since RSS feeds often embed a <p>/<img> teaser there', async () => {
    const xml = rssXml([
      {
        title: 'Article One',
        link: 'https://example.com/one',
        description:
          '&lt;p style="float:right"&gt;&lt;img src="https://example.com/cover.jpg"&gt;&lt;/p&gt;&lt;p&gt;Actual teaser text.&lt;/p&gt;',
        pubDate: 'Mon, 01 Jan 2024 00:00:00 GMT',
      },
    ]);
    mockFetch.mockResolvedValueOnce(okResponse(xml));

    const { scrapeAllFeeds } = await import('./scraper');
    const articles = await scrapeAllFeeds([{ name: 'testfeed', url: 'https://example.com/rss' }]);

    expect(articles[0].description).toBe('Actual teaser text.');
  });

  it('normalizes pubDate into an ISO publishedAt, falling back to now for unparseable dates', async () => {
    const xml = rssXml([
      { title: 'Parseable', link: 'https://example.com/a', description: 'd', pubDate: 'Mon, 01 Jan 2024 12:00:00 GMT' },
      { title: 'Unparseable', link: 'https://example.com/b', description: 'd', pubDate: 'not a date' },
    ]);
    mockFetch.mockResolvedValueOnce(okResponse(xml));

    const { scrapeAllFeeds } = await import('./scraper');
    const articles = await scrapeAllFeeds([{ name: 'testfeed', url: 'https://example.com/rss' }]);

    expect(articles[0].publishedAt).toBe('2024-01-01T12:00:00.000Z');
    expect(new Date(articles[1].publishedAt).getTime()).not.toBeNaN();
  });

  it('does not return the same article twice across calls (dedup by title+link)', async () => {
    const xml = rssXml([
      { title: 'Repeat', link: 'https://example.com/repeat', description: 'd', pubDate: 'Mon, 01 Jan 2024 00:00:00 GMT' },
    ]);
    mockFetch.mockResolvedValue(okResponse(xml));

    const { scrapeAllFeeds } = await import('./scraper');
    const feeds = [{ name: 'testfeed', url: 'https://example.com/rss' }];

    const first = await scrapeAllFeeds(feeds);
    const second = await scrapeAllFeeds(feeds);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('continues scraping other feeds when one feed fails', async () => {
    const goodXml = rssXml([
      { title: 'Good', link: 'https://good.example/a', description: 'd', pubDate: 'Mon, 01 Jan 2024 00:00:00 GMT' },
    ]);
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('bad')) {
        return Promise.reject(new Error('network boom'));
      }
      return Promise.resolve(okResponse(goodXml));
    });

    const { scrapeAllFeeds } = await import('./scraper');
    const articles = await scrapeAllFeeds([
      { name: 'badfeed', url: 'https://bad.example/rss' },
      { name: 'goodfeed', url: 'https://good.example/rss' },
    ]);

    expect(articles).toHaveLength(1);
    expect(articles[0].source).toBe('goodfeed');
  });

  it('returns an empty array and does not throw on HTTP error responses', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' });

    const { scrapeAllFeeds } = await import('./scraper');
    const articles = await scrapeAllFeeds([{ name: 'testfeed', url: 'https://example.com/rss' }]);

    expect(articles).toEqual([]);
  });
});
