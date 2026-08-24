import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { FilePublisher } from './file.publisher';
import type { ArticleWithContent } from '../pubsub';

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

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'market-rss-sentiment-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('FilePublisher', () => {
  it('creates the output directory on initialize', async () => {
    const outputDir = path.join(tmpDir, 'nested', 'articles');
    const publisher = new FilePublisher(outputDir);

    await publisher.initialize();

    const stat = await fs.stat(outputDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('appends a JSONL line with the article payload and returns the article id', async () => {
    const publisher = new FilePublisher(tmpDir);
    await publisher.initialize();

    const result = await publisher.publish(article({ source: 'cnbc' }));

    expect(result).toBe('id-1');

    const content = await fs.readFile(path.join(tmpDir, 'cnbc.jsonl'), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({
      id: 'id-1',
      title: 'Title',
      link: 'https://example.com/a',
      source: 'cnbc',
      content: 'full content',
    });
    expect(typeof parsed.fetchedAt).toBe('string');
  });

  it('appends multiple publishes to the same source as separate lines', async () => {
    const publisher = new FilePublisher(tmpDir);
    await publisher.initialize();

    await publisher.publish(article({ id: 'id-1', source: 'coindesk' }));
    await publisher.publish(article({ id: 'id-2', source: 'coindesk' }));

    const content = await fs.readFile(path.join(tmpDir, 'coindesk.jsonl'), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe('id-1');
    expect(JSON.parse(lines[1]).id).toBe('id-2');
  });

  it('writes different sources to different files', async () => {
    const publisher = new FilePublisher(tmpDir);
    await publisher.initialize();

    await publisher.publish(article({ id: 'a', source: 'bloomberg' }));
    await publisher.publish(article({ id: 'b', source: 'cnbc' }));

    const files = await fs.readdir(tmpDir);
    expect(files.sort()).toEqual(['bloomberg.jsonl', 'cnbc.jsonl']);
  });

  it('returns null instead of throwing when the write fails', async () => {
    // Point outputDir at a path that is itself a plain file, so joining a
    // filename under it and appending fails with ENOTDIR.
    const fakeDir = path.join(tmpDir, 'not-a-directory');
    await fs.writeFile(fakeDir, 'i am a file');

    const publisher = new FilePublisher(fakeDir);
    const result = await publisher.publish(article());

    expect(result).toBeNull();
  });
});
