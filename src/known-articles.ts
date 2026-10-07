import { Firestore } from '@google-cloud/firestore';
import type { Config } from './config';
import { Article } from './pubsub';

/** Firestore's getAll() has no documented cap, but keep each round trip modest. */
const LOOKUP_CHUNK_SIZE = 100;

let firestore: Firestore | undefined;
function getFirestore(config: Config): Firestore {
  if (!firestore) {
    firestore = new Firestore({ projectId: config.gcp.projectId });
  }
  return firestore;
}

/**
 * Drops articles already stored in Firestore by an earlier scrape run.
 *
 * The scraper's in-memory dedup (src/scraper.ts) only lives as long as one function instance, and
 * with scale-to-zero every scheduled run starts cold — so without this, each run would re-fetch,
 * re-publish and re-analyze (LLM) everything still listed in the feeds.
 *
 * Only applies with the `gcp` publisher (local `file` dev has no Firestore). Fails open: if the
 * lookup errors, every article is passed through, since the sentiment consumer still skips
 * already-analyzed articles itself (src/sentiment-consumer.ts) and a scrape shouldn't fail over it.
 */
export async function filterUnseenArticles(articles: Article[], config: Config): Promise<Article[]> {
  if (config.publisherType !== 'gcp' || articles.length === 0) return articles;

  try {
    const db = getFirestore(config);
    const collection = db.collection(config.articlesCollection);
    const known = new Set<string>();
    for (let i = 0; i < articles.length; i += LOOKUP_CHUNK_SIZE) {
      const refs = articles.slice(i, i + LOOKUP_CHUNK_SIZE).map((a) => collection.doc(a.id));
      const snapshots = await db.getAll(...refs);
      for (const snapshot of snapshots) if (snapshot.exists) known.add(snapshot.id);
    }
    return articles.filter((a) => !known.has(a.id));
  } catch (err) {
    console.warn('Could not check for already-stored articles, publishing all:', (err as Error).message);
    return articles;
  }
}
