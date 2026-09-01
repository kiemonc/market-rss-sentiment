import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGenerateContent, mockGoogleGenAICtor } = vi.hoisted(() => {
  const mockGenerateContent = vi.fn();
  // Must be a real `function`, not an arrow function: sentiment-analyzer.ts calls
  // `new GoogleGenAI(...)`, and arrow functions can't be constructors.
  const mockGoogleGenAICtor = vi.fn(function (this: { models: unknown }) {
    this.models = { generateContent: mockGenerateContent };
  });
  return { mockGenerateContent, mockGoogleGenAICtor };
});
vi.mock('@google/genai', () => ({
  GoogleGenAI: mockGoogleGenAICtor,
  Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', NUMBER: 'NUMBER' },
}));

import { analyzeArticleSentiment } from './sentiment-analyzer';
import type { Config } from './config';

const cfg: Config = {
  port: 8080,
  nodeEnv: 'test',
  publisherType: 'file',
  gcp: { projectId: 'test-project', pubsubTopic: 't' },
  filePublisher: { outputDir: './articles' },
  rssFeeds: [],
  pubsubEmulatorHost: null,
  vertexAi: { location: 'us-central1', model: 'gemini-2.5-flash' },
  sentimentCollection: 'sentiment',
};

beforeEach(() => {
  mockGenerateContent.mockReset();
});

describe('analyzeArticleSentiment', () => {
  // The Vertex AI client is a module-level singleton (created lazily, same pattern as
  // getFirestore() in consumer.ts), so its constructor is only invoked once for this
  // file — assert it here, on the first call.
  it('initializes the Vertex AI client from config and calls generateContent with a JSON schema', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify({ coins: [] }) });

    await analyzeArticleSentiment({ title: 'Bitcoin surges', content: 'BTC up 10%' }, cfg);

    expect(mockGoogleGenAICtor).toHaveBeenCalledWith({
      vertexai: true,
      project: 'test-project',
      location: 'us-central1',
    });
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-flash',
        contents: expect.stringContaining('Bitcoin surges'),
        config: expect.objectContaining({ responseMimeType: 'application/json' }),
      })
    );
  });

  it('converts the coins array into an uppercased ticker-keyed map', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        coins: [
          { coin: 'btc', vector: [0.7, 0.1, 0.2], weight: 0.9, sentimentDiff: 0.5 },
          { coin: 'ETH', vector: [0.2, 0.6, 0.2], weight: 0.4, sentimentDiff: -0.3 },
        ],
      }),
    });

    const result = await analyzeArticleSentiment({ title: 't', content: 'c' }, cfg);

    expect(result).toEqual({
      BTC: { vector: [0.7, 0.1, 0.2], weight: 0.9, sentimentDiff: 0.5 },
      ETH: { vector: [0.2, 0.6, 0.2], weight: 0.4, sentimentDiff: -0.3 },
    });
  });

  it('returns an empty map when the article mentions no coins', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify({ coins: [] }) });

    const result = await analyzeArticleSentiment({ title: 't', content: 'c' }, cfg);

    expect(result).toEqual({});
  });

  it('skips malformed coin entries without throwing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        coins: [
          { coin: 'BTC', vector: [0.7, 0.1, 0.2], weight: 0.9, sentimentDiff: 0.5 },
          { coin: '', vector: [1, 2], weight: 0.1, sentimentDiff: 0 },
        ],
      }),
    });

    const result = await analyzeArticleSentiment({ title: 't', content: 'c' }, cfg);

    expect(result).toEqual({ BTC: { vector: [0.7, 0.1, 0.2], weight: 0.9, sentimentDiff: 0.5 } });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('throws when Vertex AI returns an empty response', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: '' });

    await expect(analyzeArticleSentiment({ title: 't', content: 'c' }, cfg)).rejects.toThrow('empty response');
  });

  it('throws when Vertex AI returns invalid JSON', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: 'not json' });

    await expect(analyzeArticleSentiment({ title: 't', content: 'c' }, cfg)).rejects.toThrow('invalid JSON');
  });
});
