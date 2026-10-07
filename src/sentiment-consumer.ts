import { CloudEvent, cloudEvent } from '@google-cloud/functions-framework';
import { Firestore } from '@google-cloud/firestore';
import { ArticlePayload } from './pubsub';
import config from './config';
import { analyzeArticleSentiment } from './sentiment-analyzer';

interface MessagePublishedData {
  message: {
    data: string;
    messageId?: string;
    publishTime?: string;
    attributes?: Record<string, string>;
  };
  subscription?: string;
}

let firestore: Firestore | undefined;
function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore({ projectId: config.gcp.projectId });
  }
  return firestore;
}

// Subscribes to the same `market-articles` topic as consumeArticle (src/consumer.ts) via its
// own Eventarc trigger/subscription, so both consumers receive every article independently.
async function handleArticleSentiment(event: CloudEvent<MessagePublishedData>): Promise<void> {
  const message = event.data?.message;
  if (!message?.data) {
    console.warn('Received Pub/Sub event with no message data, dropping.');
    return;
  }

  let payload: ArticlePayload;
  try {
    const decoded = Buffer.from(message.data, 'base64').toString('utf-8');
    payload = JSON.parse(decoded) as ArticlePayload;
    if (!payload.id) {
      throw new Error('missing "id" field');
    }
  } catch (err) {
    console.error(
      `Permanent failure: unparseable message (messageId=${message.messageId}), dropping:`,
      (err as Error).message
    );
    return;
  }

  let coins;
  try {
    coins = await analyzeArticleSentiment(
      { title: payload.title, content: payload.content || payload.description },
      config
    );
  } catch (err) {
    // Transient: a Vertex AI call/parse failure may well succeed on retry, unlike a permanently
    // malformed Pub/Sub payload above.
    console.error(`Failed to analyze sentiment for article ${payload.id}:`, (err as Error).message);
    throw err;
  }

  try {
    await getFirestore()
      .collection(config.sentimentCollection)
      .doc(payload.id)
      .set(
        {
          articleId: payload.id,
          source: payload.source,
          // Denormalized from the article so the frontend's sentiment-over-time chart can
          // range-query/orderBy this collection alone instead of joining against `articles`.
          publishedAt: payload.publishedAt,
          analyzedAt: new Date().toISOString(),
          coins,
        },
        { merge: true }
      );
    console.log(`✓ Wrote sentiment analysis for article ${payload.id} to Firestore`);
  } catch (err) {
    console.error(`Failed to write sentiment for article ${payload.id} to Firestore:`, (err as Error).message);
    throw err;
  }
}

cloudEvent('analyzeArticleSentiment', handleArticleSentiment);

export { handleArticleSentiment };
