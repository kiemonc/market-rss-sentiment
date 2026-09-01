import { Article } from './article.model';
import { bucketDailyCounts, colorForSource } from './article-stats.util';

function article(overrides: Partial<Article>): Article {
  return {
    id: '1',
    title: 't',
    link: 'l',
    description: 'd',
    content: 'c',
    source: 'decrypt',
    pubDate: 'Mon, 01 Jan 2026 00:00:00 GMT',
    publishedAt: '2026-01-01T00:00:00.000Z',
    fetchedAt: '2026-01-01T00:05:00.000Z',
    ...overrides,
  };
}

describe('bucketDailyCounts', () => {
  it('buckets articles into per-day, per-source counts, filling gap days with 0', () => {
    const articles = [
      article({ source: 'decrypt', publishedAt: '2026-01-01T08:00:00.000Z' }),
      article({ source: 'decrypt', publishedAt: '2026-01-01T20:00:00.000Z' }),
      article({ source: 'cointelegraph', publishedAt: '2026-01-03T00:00:00.000Z' }),
    ];

    const result = bucketDailyCounts(articles, 'publishedAt', ['decrypt', 'cointelegraph'], '2026-01-01', '2026-01-03');

    expect(result.labels).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(result.datasets).toEqual([
      { source: 'decrypt', counts: [2, 0, 0] },
      { source: 'cointelegraph', counts: [0, 0, 1] },
    ]);
  });

  it('keeps a zero-filled dataset for a selected source with no matching articles', () => {
    const result = bucketDailyCounts([], 'fetchedAt', ['newsbtc'], '2026-01-01', '2026-01-02');
    expect(result.datasets).toEqual([{ source: 'newsbtc', counts: [0, 0] }]);
  });

  it('ignores articles missing the bucketed date field', () => {
    const articles = [article({ source: 'decrypt', publishedAt: undefined })];
    const result = bucketDailyCounts(articles, 'publishedAt', ['decrypt'], '2026-01-01', '2026-01-01');
    expect(result.datasets).toEqual([{ source: 'decrypt', counts: [0] }]);
  });
});

describe('colorForSource', () => {
  it('assigns colors by position in the full sorted source list, not the filtered selection', () => {
    const allSources = ['bitcoinmagazine', 'cointelegraph', 'cryptoslate', 'decrypt', 'newsbtc'];
    const colorInFullContext = colorForSource('decrypt', allSources);
    expect(colorForSource('decrypt', allSources)).toBe(colorInFullContext);
    expect(colorForSource('bitcoinmagazine', allSources)).not.toBe(colorInFullContext);
  });
});
