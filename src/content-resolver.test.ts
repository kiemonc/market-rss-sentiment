import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Article } from './pubsub';

const mockFetch = vi.hoisted(() => vi.fn());
vi.mock('node-fetch', () => ({ default: mockFetch }));

function htmlResponse(html: string, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Not Found',
    text: async () => html,
  };
}

function baseArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'abc123',
    title: 'Some title',
    link: 'https://example.com/article',
    description: 'desc',
    source: 'testsource',
    pubDate: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.resetModules();
});

describe('fetchAndParseContent', () => {
  it('extracts text from an <article> element when present', async () => {
    const longText = 'x'.repeat(150);
    mockFetch.mockResolvedValueOnce(htmlResponse(`<html><body><nav>skip</nav><article>${longText}</article></body></html>`));

    const { fetchAndParseContent } = await import('./content-resolver');
    const content = await fetchAndParseContent('https://example.com/a');

    expect(content).toBe(longText);
  });

  it('falls back to full body text when no selector matches enough content', async () => {
    mockFetch.mockResolvedValueOnce(htmlResponse('<html><body><p>short body text here</p></body></html>'));

    const { fetchAndParseContent } = await import('./content-resolver');
    const content = await fetchAndParseContent('https://example.com/b');

    expect(content).toContain('short body text here');
  });

  it('returns null without throwing on a non-OK HTTP response', async () => {
    mockFetch.mockResolvedValueOnce(htmlResponse('', false, 404));

    const { fetchAndParseContent } = await import('./content-resolver');
    const content = await fetchAndParseContent('https://example.com/missing');

    expect(content).toBeNull();
  });

  it('returns null immediately for an empty link, without calling fetch', async () => {
    const { fetchAndParseContent } = await import('./content-resolver');
    const content = await fetchAndParseContent('');

    expect(content).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('caches content per link so a repeated fetch is not re-requested', async () => {
    const longText = 'y'.repeat(150);
    mockFetch.mockResolvedValue(htmlResponse(`<article>${longText}</article>`));

    const { fetchAndParseContent } = await import('./content-resolver');
    const first = await fetchAndParseContent('https://example.com/cached');
    const second = await fetchAndParseContent('https://example.com/cached');

    expect(first).toBe(longText);
    expect(second).toBe(longText);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('resolveArticleContent', () => {
  it('merges the fetched content and a contentFetchedAt timestamp onto the article', async () => {
    const longText = 'z'.repeat(150);
    mockFetch.mockResolvedValueOnce(htmlResponse(`<article>${longText}</article>`));

    const { resolveArticleContent } = await import('./content-resolver');
    const article = baseArticle();
    const resolved = await resolveArticleContent(article);

    expect(resolved).toMatchObject({ ...article, content: longText });
    expect(new Date(resolved.contentFetchedAt as string).toISOString()).toBe(resolved.contentFetchedAt);
  });

  it('uses an empty string for content when resolution fails', async () => {
    mockFetch.mockResolvedValueOnce(htmlResponse('', false, 500));

    const { resolveArticleContent } = await import('./content-resolver');
    const resolved = await resolveArticleContent(baseArticle({ link: 'https://example.com/fail' }));

    expect(resolved.content).toBe('');
  });
});

describe('resolveMultipleArticles', () => {
  it('resolves every article and preserves order', async () => {
    mockFetch.mockImplementation(async (url: string) => htmlResponse(`<article>content for ${url}</article>${'-'.repeat(120)}`));

    const { resolveMultipleArticles } = await import('./content-resolver');
    const articles = [
      baseArticle({ id: '1', link: 'https://example.com/1' }),
      baseArticle({ id: '2', link: 'https://example.com/2' }),
    ];
    const resolved = await resolveMultipleArticles(articles);

    expect(resolved).toHaveLength(2);
    expect(resolved[0].id).toBe('1');
    expect(resolved[0].content).toContain('https://example.com/1');
    expect(resolved[1].id).toBe('2');
    expect(resolved[1].content).toContain('https://example.com/2');
  });
});
