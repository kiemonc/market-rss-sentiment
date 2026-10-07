import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from './config';
import type { Article } from './pubsub';

const { mockGetAll, mockDoc, mockCollection, mockFirestoreCtor } = vi.hoisted(() => {
  const mockGetAll = vi.fn();
  const mockDoc = vi.fn((id: string) => ({ id }));
  const mockCollection = vi.fn(() => ({ doc: mockDoc }));
  // Must be a real `function`, not an arrow function: known-articles.ts calls `new Firestore(...)`.
  const mockFirestoreCtor = vi.fn(function () {
    return { collection: mockCollection, getAll: mockGetAll };
  });
  return { mockGetAll, mockDoc, mockCollection, mockFirestoreCtor };
});
vi.mock('@google-cloud/firestore', () => ({ Firestore: mockFirestoreCtor }));

import { filterUnseenArticles } from './known-articles';

const gcpConfig = {
  publisherType: 'gcp',
  gcp: { projectId: 'p', pubsubTopic: 't' },
  articlesCollection: 'articles',
} as Config;

function article(id: string): Article {
  return { id, title: id, link: `https://x/${id}`, description: '', source: 's', pubDate: '', publishedAt: '' };
}

beforeEach(() => {
  mockGetAll.mockReset();
  mockDoc.mockClear();
  mockCollection.mockClear();
});

describe('filterUnseenArticles', () => {
  it('drops articles already stored in Firestore', async () => {
    mockGetAll.mockImplementation(async (...refs: { id: string }[]) =>
      refs.map((ref) => ({ id: ref.id, exists: ref.id === 'old' }))
    );

    const result = await filterUnseenArticles([article('old'), article('new')], gcpConfig);

    expect(mockCollection).toHaveBeenCalledWith('articles');
    expect(result.map((a) => a.id)).toEqual(['new']);
  });

  it('looks articles up in chunks', async () => {
    mockGetAll.mockImplementation(async (...refs: { id: string }[]) => refs.map((ref) => ({ id: ref.id, exists: false })));
    const articles = Array.from({ length: 250 }, (_, i) => article(`a${i}`));

    const result = await filterUnseenArticles(articles, gcpConfig);

    expect(mockGetAll).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(250);
  });

  it('passes everything through when the lookup fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetAll.mockRejectedValueOnce(new Error('permission denied'));

    const result = await filterUnseenArticles([article('a'), article('b')], gcpConfig);

    expect(result.map((a) => a.id)).toEqual(['a', 'b']);
    warnSpy.mockRestore();
  });

  it('skips the lookup entirely for the local file publisher', async () => {
    const result = await filterUnseenArticles([article('a')], { ...gcpConfig, publisherType: 'file' });

    expect(mockGetAll).not.toHaveBeenCalled();
    expect(result.map((a) => a.id)).toEqual(['a']);
  });
});
