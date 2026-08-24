import { describe, it, expect } from 'vitest';
import { createPublisher, GoogleCloudPublisher, FilePublisher } from './index';

describe('createPublisher', () => {
  it('creates a GoogleCloudPublisher for type "gcp"', () => {
    const publisher = createPublisher('gcp', { gcp: { projectId: 'p', pubsubTopic: 't' } });

    expect(publisher).toBeInstanceOf(GoogleCloudPublisher);
  });

  it('creates a FilePublisher for type "file"', () => {
    const publisher = createPublisher('file', { filePublisher: { outputDir: '/tmp/articles' } });

    expect(publisher).toBeInstanceOf(FilePublisher);
  });

  it('defaults the FilePublisher output dir when config.filePublisher is missing', () => {
    const publisher = createPublisher('file', {});

    expect(publisher).toBeInstanceOf(FilePublisher);
  });

  it('throws for an unknown publisher type', () => {
    expect(() => createPublisher('bogus' as unknown as 'file', {})).toThrow(/Unknown publisher type/);
  });
});
