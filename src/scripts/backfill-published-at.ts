// One-off migration: adds `publishedAt` (pubDate normalized to ISO 8601) to existing
// `articles` documents written before that field existed, so the frontend's "Publication
// date" column/sort/filter (which orderBy()s on `publishedAt`) doesn't silently drop them —
// Firestore excludes a document from an orderBy() query entirely if it lacks that field.
//
// Run with: npx ts-node src/scripts/backfill-published-at.ts
// Requires Application Default Credentials for a principal with Firestore read/write access
// to the target project (gcloud auth application-default login).
import { Firestore } from '@google-cloud/firestore';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'cloud-playground-mchmielecki';
const COLLECTION = process.env.FIRESTORE_COLLECTION || 'articles';
const BATCH_SIZE = 400; // Firestore batched writes cap at 500 operations.

function toPublishedAt(pubDate: unknown): string {
  const parsed = new Date(typeof pubDate === 'string' ? pubDate : NaN);
  return (isNaN(parsed.getTime()) ? new Date() : parsed).toISOString();
}

async function main(): Promise<void> {
  const firestore = new Firestore({ projectId: PROJECT_ID });
  const snapshot = await firestore.collection(COLLECTION).get();

  const toUpdate = snapshot.docs.filter((doc) => !doc.data().publishedAt);
  console.log(`${snapshot.size} articles total, ${toUpdate.length} missing publishedAt.`);

  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const chunk = toUpdate.slice(i, i + BATCH_SIZE);
    const batch = firestore.batch();
    for (const doc of chunk) {
      batch.update(doc.ref, { publishedAt: toPublishedAt(doc.data().pubDate) });
    }
    await batch.commit();
    console.log(`Backfilled ${Math.min(i + BATCH_SIZE, toUpdate.length)}/${toUpdate.length}`);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
