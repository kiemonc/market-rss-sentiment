import { PubSub, Topic } from '@google-cloud/pubsub';
import { ArticleWithContent } from '../pubsub';
import { Publisher } from './publisher.interface';

export class GoogleCloudPublisher implements Publisher {
  private pubsubClient: PubSub;
  private topic: Topic;

  constructor(projectId: string, topicName: string) {
    this.pubsubClient = new PubSub({ projectId });
    this.topic = this.pubsubClient.topic(topicName);
  }

  async initialize(): Promise<void> {
    try {
      const [topicExists] = await this.topic.exists();
      if (!topicExists) {
        console.warn(`⚠️  Topic ${this.topic.name} does not exist. Ensure it's created in GCP.`);
      }
    } catch (err) {
      console.warn('Could not verify Pub/Sub topic existence:', (err as Error).message);
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
      publishedAt: article.publishedAt,
      contentFetchedAt: article.contentFetchedAt,
      fetchedAt: new Date().toISOString(),
    };

    try {
      const messageId = await this.topic.publish(Buffer.from(JSON.stringify(payload)));
      console.log(`✓ Published to Pub/Sub: "${article.title.substring(0, 50)}..." (${messageId})`);
      return messageId;
    } catch (err) {
      console.error('✗ Failed to publish article:', (err as Error).message);
      return null;
    }
  }
}

