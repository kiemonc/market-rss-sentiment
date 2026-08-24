import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ArticleWithContent } from '../pubsub';

const { mockExists, mockPublish, mockTopicFn, mockPubSubCtor } = vi.hoisted(() => {
  const mockExists = vi.fn();
  const mockPublish = vi.fn();
  const mockTopicFn = vi.fn((name: string) => ({ name, exists: mockExists, publish: mockPublish }));
  // Must be a real `function`, not an arrow function: GoogleCloudPublisher
  // calls `new PubSub(...)`, and arrow functions can't be constructors.
  const mockPubSubCtor = vi.fn(function () {
    return { topic: mockTopicFn };
  });
  return { mockExists, mockPublish, mockTopicFn, mockPubSubCtor };
});

vi.mock('@google-cloud/pubsub', () => ({ PubSub: mockPubSubCtor }));

import { GoogleCloudPublisher } from './google-cloud.publisher';

function article(overrides: Partial<ArticleWithContent> = {}): ArticleWithContent {
  return {
    id: 'id-1',
    title: 'Title',
    link: 'https://example.com/a',
    description: 'desc',
    source: 'bloomberg',
    pubDate: '2024-01-01T00:00:00.000Z',
    content: 'full content',
    contentFetchedAt: '2024-01-01T00:00:01.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockExists.mockReset();
  mockPublish.mockReset();
  mockTopicFn.mockClear();
  mockPubSubCtor.mockClear();
});

describe('GoogleCloudPublisher', () => {
  it('constructs a PubSub client with the project id and a topic with the topic name', () => {
    new GoogleCloudPublisher('my-project', 'my-topic');

    expect(mockPubSubCtor).toHaveBeenCalledWith({ projectId: 'my-project' });
    expect(mockTopicFn).toHaveBeenCalledWith('my-topic');
  });

  describe('initialize', () => {
    it('does not warn when the topic exists', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockExists.mockResolvedValueOnce([true]);

      await new GoogleCloudPublisher('p', 't').initialize();

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('warns but does not throw when the topic does not exist', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockExists.mockResolvedValueOnce([false]);

      await expect(new GoogleCloudPublisher('p', 't').initialize()).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('warns but does not throw when checking existence fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockExists.mockRejectedValueOnce(new Error('boom'));

      await expect(new GoogleCloudPublisher('p', 't').initialize()).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('publish', () => {
    it('publishes the article as JSON and returns the message id', async () => {
      mockPublish.mockResolvedValueOnce('message-123');

      const result = await new GoogleCloudPublisher('p', 't').publish(article());

      expect(result).toBe('message-123');
      expect(mockPublish).toHaveBeenCalledTimes(1);

      const buffer: Buffer = mockPublish.mock.calls[0][0];
      const payload = JSON.parse(buffer.toString());
      expect(payload).toMatchObject({
        id: 'id-1',
        title: 'Title',
        link: 'https://example.com/a',
        content: 'full content',
      });
      expect(typeof payload.fetchedAt).toBe('string');
    });

    it('returns null instead of throwing when publish fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPublish.mockRejectedValueOnce(new Error('boom'));

      const result = await new GoogleCloudPublisher('p', 't').publish(article());

      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});
