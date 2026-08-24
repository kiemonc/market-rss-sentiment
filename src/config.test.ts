import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// config.ts side-effect-imports 'dotenv/config', which would otherwise load
// this repo's real (gitignored) .env file and pollute/undermine the
// "unset means default" test cases below.
vi.mock('dotenv/config', () => ({}));

const ENV_KEYS = [
  'PORT',
  'NODE_ENV',
  'PUBLISHER_TYPE',
  'GCP_PROJECT_ID',
  'PUBSUB_TOPIC',
  'ARTICLES_OUTPUT_DIR',
  'RSS_FEEDS',
  'PUBSUB_EMULATOR_HOST',
] as const;

let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>>;

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('config', () => {
  it('uses sensible defaults when no env vars are set', async () => {
    const { default: config } = await import('./config');

    expect(config.port).toBe(8080);
    expect(config.nodeEnv).toBe('development');
    expect(config.publisherType).toBe('file');
    expect(config.gcp.projectId).toBe('test-project');
    expect(config.gcp.pubsubTopic).toBe('market-articles');
    expect(config.filePublisher.outputDir).toBe('./articles');
    expect(config.rssFeeds).toEqual([]);
    expect(config.pubsubEmulatorHost).toBeNull();
  });

  it('defaults publisherType to gcp in production when PUBLISHER_TYPE is unset', async () => {
    process.env.NODE_ENV = 'production';

    const { default: config } = await import('./config');

    expect(config.publisherType).toBe('gcp');
  });

  it('PUBLISHER_TYPE env var overrides the NODE_ENV-based default', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLISHER_TYPE = 'file';

    const { default: config } = await import('./config');

    expect(config.publisherType).toBe('file');
  });

  it('parses valid RSS_FEEDS JSON', async () => {
    process.env.RSS_FEEDS = JSON.stringify([{ name: 'a', url: 'https://a.example/rss' }]);

    const { default: config } = await import('./config');

    expect(config.rssFeeds).toEqual([{ name: 'a', url: 'https://a.example/rss' }]);
  });

  it('falls back to an empty array and warns on invalid RSS_FEEDS JSON', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.RSS_FEEDS = 'not json';

    const { default: config } = await import('./config');

    expect(config.rssFeeds).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('reads PORT, gcp settings and PUBSUB_EMULATOR_HOST from env', async () => {
    process.env.PORT = '9090';
    process.env.GCP_PROJECT_ID = 'my-project';
    process.env.PUBSUB_TOPIC = 'my-topic';
    process.env.PUBSUB_EMULATOR_HOST = 'localhost:8085';

    const { default: config } = await import('./config');

    expect(config.port).toBe(9090);
    expect(config.gcp.projectId).toBe('my-project');
    expect(config.gcp.pubsubTopic).toBe('my-topic');
    expect(config.pubsubEmulatorHost).toBe('localhost:8085');
  });
});
