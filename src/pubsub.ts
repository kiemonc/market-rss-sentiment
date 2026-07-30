import { PubSub, Topic } from '@google-cloud/pubsub';
import config from './config';

interface Article {
  id: string;
  title: string;
  link: string;
  description: string;
  source: string;
  pubDate: string;
}

interface ArticlePayload extends Article {
  fetchedAt: string;
}

let pubsubClient: PubSub;
let topic: Topic;

async function initPubSub(): Promise<void> {
  const pubsubConfig = {
    projectId: config.gcp.projectId,
  };

  if (config.pubsubEmulatorHost) {
    console.log(`Using Pub/Sub emulator at ${config.pubsubEmulatorHost}`);
  }

  pubsubClient = new PubSub(pubsubConfig);
  topic = pubsubClient.topic(config.gcp.pubsubTopic);

  try {
    const [topicExists] = await topic.exists();
    if (!topicExists) {
      console.log(`Topic ${config.gcp.pubsubTopic} does not exist. In production, ensure it's created in GCP.`);
      if (config.nodeEnv === 'development') {
        console.log('Running in development mode — will mock Pub/Sub publishing.');
      }
    }
  } catch (err) {
    console.warn('Could not verify topic existence:', (err as Error).message);
  }
}

async function publishArticle(article: Article): Promise<string | null> {
  if (!topic) {
    console.error('Pub/Sub not initialized. Call initPubSub() first.');
    return null;
  }

  const payload: ArticlePayload = {
    id: article.id,
    title: article.title,
    link: article.link,
    description: article.description,
    source: article.source,
    pubDate: article.pubDate,
    fetchedAt: new Date().toISOString(),
  };

  try {
    const messageId = await topic.publish(Buffer.from(JSON.stringify(payload)));
    console.log(`Published article "${article.title}" to Pub/Sub (messageId: ${messageId})`);
    return messageId;
  } catch (err) {
    console.error('Failed to publish article:', (err as Error).message);
    return null;
  }
}

export { initPubSub, publishArticle };
export type { Article, ArticlePayload };
