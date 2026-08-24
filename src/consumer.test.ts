import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSet, mockDoc, mockCollection, mockFirestoreCtor } = vi.hoisted(() => {
  const mockSet = vi.fn();
  const mockDoc = vi.fn(() => ({ set: mockSet }));
  const mockCollection = vi.fn(() => ({ doc: mockDoc }));
  // Must be a real `function`, not an arrow function: consumer.ts calls
  // `new Firestore(...)`, and arrow functions can't be constructors.
  const mockFirestoreCtor = vi.fn(function () {
    return { collection: mockCollection };
  });
  return { mockSet, mockDoc, mockCollection, mockFirestoreCtor };
});

vi.mock('@google-cloud/firestore', () => ({ Firestore: mockFirestoreCtor }));

const mockCloudEvent = vi.hoisted(() => vi.fn());
vi.mock('@google-cloud/functions-framework', () => ({ cloudEvent: mockCloudEvent }));

import { handleArticleMessage } from './consumer';

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

beforeEach(() => {
  mockSet.mockReset();
  mockDoc.mockClear();
  mockCollection.mockClear();
});

describe('consumeArticle registration', () => {
  it('registers the handler with functions-framework on import', () => {
    expect(mockCloudEvent).toHaveBeenCalledWith('consumeArticle', handleArticleMessage);
  });
});

describe('handleArticleMessage', () => {
  it('drops the message without writing when there is no message data', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(handleArticleMessage({ data: { message: {} } } as never)).resolves.toBeUndefined();

    expect(mockSet).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('drops unparseable (non-JSON) messages without throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(handleArticleMessage(eventFor('not valid json'))).resolves.toBeUndefined();

    expect(mockSet).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Permanent failure'),
      expect.anything()
    );
    errorSpy.mockRestore();
  });

  it('drops messages missing an "id" field without throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { id, ...withoutId } = validArticle;

    await expect(handleArticleMessage(eventFor(withoutId))).resolves.toBeUndefined();

    expect(mockSet).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('writes a valid article to Firestore as an idempotent upsert', async () => {
    mockSet.mockResolvedValueOnce(undefined);

    await handleArticleMessage(eventFor(validArticle));

    expect(mockCollection).toHaveBeenCalledWith('articles');
    expect(mockDoc).toHaveBeenCalledWith('article-1');
    expect(mockSet).toHaveBeenCalledWith(validArticle, { merge: true });
  });

  it('rethrows when the Firestore write fails, so Pub/Sub retries', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSet.mockRejectedValueOnce(new Error('firestore unavailable'));

    await expect(handleArticleMessage(eventFor(validArticle))).rejects.toThrow('firestore unavailable');

    errorSpy.mockRestore();
  });
});

describe('FIRESTORE_COLLECTION env var', () => {
  it('is honored for the collection name and passed through to a fresh Firestore client', async () => {
    const previous = process.env.FIRESTORE_COLLECTION;
    const previousProject = process.env.GCP_PROJECT_ID;
    process.env.FIRESTORE_COLLECTION = 'custom-articles';
    process.env.GCP_PROJECT_ID = 'custom-project';
    vi.resetModules();

    try {
      const freshMockSet = vi.fn().mockResolvedValueOnce(undefined);
      const freshMockDoc = vi.fn(() => ({ set: freshMockSet }));
      const freshMockCollection = vi.fn(() => ({ doc: freshMockDoc }));
      const freshMockFirestoreCtor = vi.fn(function () {
        return { collection: freshMockCollection };
      });

      vi.doMock('@google-cloud/firestore', () => ({ Firestore: freshMockFirestoreCtor }));
      vi.doMock('@google-cloud/functions-framework', () => ({ cloudEvent: vi.fn() }));

      const { handleArticleMessage: freshHandler } = await import('./consumer');
      await freshHandler(eventFor(validArticle));

      expect(freshMockFirestoreCtor).toHaveBeenCalledWith({ projectId: 'custom-project' });
      expect(freshMockCollection).toHaveBeenCalledWith('custom-articles');
    } finally {
      if (previous === undefined) delete process.env.FIRESTORE_COLLECTION;
      else process.env.FIRESTORE_COLLECTION = previous;
      if (previousProject === undefined) delete process.env.GCP_PROJECT_ID;
      else process.env.GCP_PROJECT_ID = previousProject;
      vi.resetModules();
    }
  });
});
