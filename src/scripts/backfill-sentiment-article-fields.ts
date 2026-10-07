// One-off migration: copies each article's `publishedAt` and `title` onto its
// `sentiment/{articleId}` doc, for sentiment docs written before the sentiment consumer started
// denormalizing those fields. The frontend's sentiment-over-time chart range-queries/orderBy()s
// `sentiment` on `publishedAt` — Firestore silently excludes any document missing an orderBy()
// field from such a query — and labels its per-article points with `title`.
//
// Run with: node src/scripts/backfill-sentiment-article-fields.ts  (Node ≥ 22.18 strips the types
// natively; ts-node is incompatible with the TypeScript 7 this project uses)
// Requires Application Default Credentials for a principal with Firestore read/write access
// to the target project (gcloud auth application-default login).
import { Firestore } from '@google-cloud/firestore';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'cloud-playground-mchmielecki';
const ARTICLES_COLLECTION = process.env.FIRESTORE_COLLECTION || 'articles';
const SENTIMENT_COLLECTION = process.env.SENTIMENT_COLLECTION || 'sentiment';
const BATCH_SIZE = 400; // Firestore batched writes cap at 500 operations.
const FIELDS = ['publishedAt', 'title'] as const;

async function main(): Promise<void> {
  const firestore = new Firestore({ projectId: PROJECT_ID });
  const snapshot = await firestore.collection(SENTIMENT_COLLECTION).get();

  const toUpdate = snapshot.docs.filter((doc) => FIELDS.some((field) => !doc.data()[field]));
  console.log(`${snapshot.size} sentiment docs total, ${toUpdate.length} missing ${FIELDS.join('/')}.`);

  let missingArticle = 0;
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const chunk = toUpdate.slice(i, i + BATCH_SIZE);
    const articles = await firestore.getAll(
      ...chunk.map((doc) => firestore.collection(ARTICLES_COLLECTION).doc(doc.id))
    );
    const batch = firestore.batch();
    chunk.forEach((doc, j) => {
      const update: Record<string, string> = {};
      for (const field of FIELDS) {
        const value = articles[j].get(field);
        if (typeof value === 'string') update[field] = value;
      }
      if (Object.keys(update).length) {
        batch.update(doc.ref, update);
      } else {
        missingArticle++;
      }
    });
    await batch.commit();
    console.log(`Processed ${Math.min(i + BATCH_SIZE, toUpdate.length)}/${toUpdate.length}`);
  }

  console.log(`Done. ${missingArticle} sentiment docs skipped (article missing or without those fields).`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
