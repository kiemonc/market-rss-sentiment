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

  // The scraper's own "already seen" check (src/known-articles.ts) is best-effort, and Pub/Sub
  // delivery is at-least-once, so the same article can still arrive here more than once. The LLM
  // call is this pipeline's main cost, so never pay for it twice: an existing analysis wins.
  // To force a re-analysis (e.g. after a prompt change), delete the `sentiment/{id}` docs first.
  const sentimentRef = getFirestore().collection(config.sentimentCollection).doc(payload.id);
  let alreadyAnalyzed: boolean;
  try {
    alreadyAnalyzed = (await sentimentRef.get()).exists;
  } catch (err) {
    // Transient: rethrow so Pub/Sub retries, rather than risk a duplicate LLM call.
    console.error(`Failed to check existing sentiment for article ${payload.id}:`, (err as Error).message);
    throw err;
  }
  if (alreadyAnalyzed) {
    console.log(`Sentiment for article ${payload.id} already exists, skipping analysis.`);
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
    await sentimentRef.set(
        {
          articleId: payload.id,
          source: payload.source,
          // Denormalized from the article so the frontend's sentiment-over-time chart can
          // range-query/orderBy this collection alone (and label its per-article points)
          // instead of joining against `articles`, whose docs carry the full content.
          publishedAt: payload.publishedAt,
          title: payload.title,
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
