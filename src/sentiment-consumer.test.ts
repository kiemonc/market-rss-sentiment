import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  gcp: { projectId: 'test-project', pubsubTopic: 't' },
  vertexAi: { location: 'us-central1', model: 'gemini-2.5-flash' },
  sentimentCollection: 'sentiment',
}));
vi.mock('./config', () => ({ default: mockConfig }));

const { mockSet, mockDoc, mockCollection, mockFirestoreCtor } = vi.hoisted(() => {
  const mockSet = vi.fn();
  const mockDoc = vi.fn(() => ({ set: mockSet }));
  const mockCollection = vi.fn(() => ({ doc: mockDoc }));
  // Must be a real `function`, not an arrow function: sentiment-consumer.ts calls
  // `new Firestore(...)`, and arrow functions can't be constructors.
  const mockFirestoreCtor = vi.fn(function () {
    return { collection: mockCollection };
  });
  return { mockSet, mockDoc, mockCollection, mockFirestoreCtor };
});
vi.mock('@google-cloud/firestore', () => ({ Firestore: mockFirestoreCtor }));

const mockCloudEvent = vi.hoisted(() => vi.fn());
vi.mock('@google-cloud/functions-framework', () => ({ cloudEvent: mockCloudEvent }));

const mockAnalyzeArticleSentiment = vi.hoisted(() => vi.fn());
vi.mock('./sentiment-analyzer', () => ({ analyzeArticleSentiment: mockAnalyzeArticleSentiment }));

import { handleArticleSentiment } from './sentiment-consumer';

function eventFor(payload: unknown, messageId = 'msg-1') {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return {
    data: { message: { data: Buffer.from(data, 'utf-8').toString('base64'), messageId } },
  } as never;
}

const validArticle = {
  id: 'article-1',
  title: 'Title',
  link: 'https://example.com/a',
  description: 'desc',
  content: 'full content',
  source: 'bloomberg',
  pubDate: '2024-01-01T00:00:00.000Z',
  fetchedAt: '2024-01-01T00:00:01.000Z',
};

const sentimentResult = {
  BTC: { vector: [0.7, 0.1, 0.2], weight: 0.9, sentimentDiff: 0.5 },
};

beforeEach(() => {
  mockSet.mockReset();
  mockDoc.mockClear();
  mockCollection.mockClear();
  mockAnalyzeArticleSentiment.mockReset();
});

describe('analyzeArticleSentiment registration', () => {
  it('registers the handler with functions-framework on import', () => {
    expect(mockCloudEvent).toHaveBeenCalledWith('analyzeArticleSentiment', handleArticleSentiment);
  });
});

describe('handleArticleSentiment', () => {
  it('drops the message without writing when there is no message data', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(handleArticleSentiment({ data: { message: {} } } as never)).resolves.toBeUndefined();

    expect(mockAnalyzeArticleSentiment).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('drops unparseable (non-JSON) messages without throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(handleArticleSentiment(eventFor('not valid json'))).resolves.toBeUndefined();

    expect(mockAnalyzeArticleSentiment).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Permanent failure'), expect.anything());
    errorSpy.mockRestore();
  });

  it('drops messages missing an "id" field without throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { id, ...withoutId } = validArticle;

    await expect(handleArticleSentiment(eventFor(withoutId))).resolves.toBeUndefined();

    expect(mockAnalyzeArticleSentiment).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('analyzes the article and writes the per-coin sentiment map to Firestore', async () => {
    mockAnalyzeArticleSentiment.mockResolvedValueOnce(sentimentResult);
    mockSet.mockResolvedValueOnce(undefined);

    await handleArticleSentiment(eventFor(validArticle));

    expect(mockAnalyzeArticleSentiment).toHaveBeenCalledWith(
      { title: 'Title', content: 'full content' },
      mockConfig
    );
    expect(mockCollection).toHaveBeenCalledWith('sentiment');
    expect(mockDoc).toHaveBeenCalledWith('article-1');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        articleId: 'article-1',
        source: 'bloomberg',
        coins: sentimentResult,
      }),
      { merge: true }
    );
  });

  it('falls back to the description when content is missing', async () => {
    mockAnalyzeArticleSentiment.mockResolvedValueOnce({});
    mockSet.mockResolvedValueOnce(undefined);
    const { content, ...withoutContent } = validArticle;

    await handleArticleSentiment(eventFor(withoutContent));

    expect(mockAnalyzeArticleSentiment).toHaveBeenCalledWith({ title: 'Title', content: 'desc' }, mockConfig);
  });

  it('rethrows when sentiment analysis fails, so Pub/Sub retries', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockAnalyzeArticleSentiment.mockRejectedValueOnce(new Error('vertex ai unavailable'));

    await expect(handleArticleSentiment(eventFor(validArticle))).rejects.toThrow('vertex ai unavailable');

    expect(mockSet).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('rethrows when the Firestore write fails, so Pub/Sub retries', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockAnalyzeArticleSentiment.mockResolvedValueOnce(sentimentResult);
    mockSet.mockRejectedValueOnce(new Error('firestore unavailable'));

    await expect(handleArticleSentiment(eventFor(validArticle))).rejects.toThrow('firestore unavailable');

    errorSpy.mockRestore();
  });
});
