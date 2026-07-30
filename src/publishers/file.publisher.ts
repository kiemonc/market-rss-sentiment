import fs from 'fs/promises';
import path from 'path';
import { ArticleWithContent } from '../pubsub';
import { Publisher } from './publisher.interface';

export class FilePublisher implements Publisher {
  private outputDir: string;

  constructor(outputDir: string = './articles') {
    this.outputDir = outputDir;
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
      console.log(`📁 File publisher initialized. Articles will be saved to: ${this.outputDir}/<feed-name>.jsonl`);
    } catch (err) {
      console.error('Failed to create output directory:', (err as Error).message);
      throw err;
    }
  }

  async publish(article: ArticleWithContent): Promise<string | null> {
    const payload = {
      id: article.id,
      title: article.title,
      link: article.link,
      description: article.description,
      content: article.content,
      source: article.source,
      pubDate: article.pubDate,
      contentFetchedAt: article.contentFetchedAt,
      fetchedAt: new Date().toISOString(),
    };

    try {
      const outputFile = path.join(this.outputDir, `${article.source}.jsonl`);
      const jsonLine = JSON.stringify(payload) + '\n';
      await fs.appendFile(outputFile, jsonLine, 'utf-8');
      return article.id;
    } catch (err) {
      console.error('✗ Failed to write article to file:', (err as Error).message);
      return null;
    }
  }

  async close(): Promise<void> {
    console.log(`✓ File publisher closed. Articles saved to: ${this.outputDir}/`);
  }
}

