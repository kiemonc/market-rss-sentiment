// Mirrors the ArticlePayload written by the consumer function to `articles/{id}`
// (see ../../../src/pubsub.ts and ../../../src/consumer.ts in the main project).
export interface Article {
  id: string;
  title: string;
  link: string;
  description: string;
  content: string;
  source: string;
  pubDate: string;
  contentFetchedAt?: string;
  fetchedAt: string;
}
