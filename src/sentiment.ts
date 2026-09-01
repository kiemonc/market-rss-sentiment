interface CoinSentiment {
  /** [bullish, bearish, neutral] confidence scores from the LLM, each in [0,1], roughly summing to 1. */
  vector: [number, number, number];
  /** How prominently/relevantly this coin features in the article, in [0,1]. */
  weight: number;
  /** Signed impact on investor sentiment for this coin: positive = bullish, negative = bearish, in [-1,1]. */
  sentimentDiff: number;
}

/** Coin ticker (e.g. "BTC") -> its sentiment analysis for one article. */
type SentimentAnalysis = Record<string, CoinSentiment>;

export type { CoinSentiment, SentimentAnalysis };
