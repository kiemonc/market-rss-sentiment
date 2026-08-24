import { CloudEvent, cloudEvent } from '@google-cloud/functions-framework';
import { Firestore } from '@google-cloud/firestore';
import { ArticlePayload } from './pubsub';

interface MessagePublishedData {
  message: {
    data: string;
    messageId?: string;
    publishTime?: string;
    attributes?: Record<string, string>;
  };
  subscription?: string;
}

const COLLECTION = process.env.FIRESTORE_COLLECTION || 'articles';

let firestore: Firestore | undefined;
function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore({ projectId: process.env.GCP_PROJECT_ID });
  }
  return firestore;
}

async function handleArticleMessage(event: CloudEvent<MessagePublishedData>): Promise<void> {
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

  try {
    await getFirestore().collection(COLLECTION).doc(payload.id).set(payload, { merge: true });
    console.log(`✓ Wrote article ${payload.id} to Firestore`);
  } catch (err) {
    console.error(`Failed to write article ${payload.id} to Firestore:`, (err as Error).message);
    throw err;
  }
}

cloudEvent('consumeArticle', handleArticleMessage);

export { handleArticleMessage };
