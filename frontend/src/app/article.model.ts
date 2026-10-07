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
  /** `pubDate` normalized to ISO 8601. Absent on articles scraped before this field existed. */
  publishedAt?: string;
  contentFetchedAt?: string;
  fetchedAt: string;
}

// Mirrors the per-article sentiment doc written by the sentiment consumer function to
// `sentiment/{articleId}` (see ../../../src/sentiment.ts and ../../../src/sentiment-consumer.ts).
export interface CoinSentiment {
  /** [bullish, bearish, neutral] confidence scores from the LLM, each in [0,1], roughly summing to 1. */
  vector: [number, number, number];
  /** How prominently/relevantly this coin features in the article, in [0,1]. */
  weight: number;
  /** Signed impact on investor sentiment for this coin: positive = bullish, negative = bearish, in [-1,1]. */
  sentimentDiff: number;
}

export interface SentimentAnalysis {
  articleId: string;
  source: string;
  /** The article's `publishedAt`, denormalized for time-range queries. Absent on very old docs not yet backfilled. */
  publishedAt?: string;
  /** The article's title, denormalized for chart labels. Absent on very old docs not yet backfilled. */
  title?: string;
  analyzedAt: string;
  /** Coin ticker (e.g. "BTC") -> its sentiment analysis for this article. */
  coins: Record<string, CoinSentiment>;
}
