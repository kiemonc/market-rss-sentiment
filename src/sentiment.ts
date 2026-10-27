interface CoinSentiment {
  /** [bullish, bearish, neutral] confidence scores from the LLM, each in [0,1], roughly summing to 1. */
  vector: [number, number, number];
  /** How prominently/relevantly this coin features in the article, in [0,1]. */
  weight: number;
  /** Signed impact on investor sentiment for this coin: positive = bullish, negative = bearish, in [-1,1]. */
  sentimentDiff: number;
  /**
   * True when the article's take on this coin is mainly a recap of its own past price moves rather
   * than new information. Absent on analyses made before this field was introduced.
   */
  priceRecap?: boolean;
}

/** Coin ticker (e.g. "BTC") -> its sentiment analysis for one article. */
type SentimentAnalysis = Record<string, CoinSentiment>;

export type { CoinSentiment, SentimentAnalysis };
