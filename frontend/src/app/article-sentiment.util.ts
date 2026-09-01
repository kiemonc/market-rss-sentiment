import { CoinSentiment } from './article.model';

export type SentimentDirection = 'bullish' | 'bearish' | 'neutral';

/** Below this |sentimentDiff| the impact reads as neutral rather than a (near-zero) bull/bear call. */
const NEUTRAL_THRESHOLD = 0.05;

/** Coins ordered most-to-least relevant to the article, for a stable, meaningful display order. */
export function sortedCoinEntries(coins: Record<string, CoinSentiment>): [string, CoinSentiment][] {
  return Object.entries(coins).sort((a, b) => b[1].weight - a[1].weight);
}

/** Clamps a [0,1] confidence/weight into a whole-number percentage. */
export function toPercent(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

export function sentimentDirection(diff: number): SentimentDirection {
  if (diff > NEUTRAL_THRESHOLD) return 'bullish';
  if (diff < -NEUTRAL_THRESHOLD) return 'bearish';
  return 'neutral';
}

/**
 * Left offset + width (both in %) for a diverging meter fill on a [-1,1] track anchored at a
 * center (50%) zero-line: positive diffs grow rightward from center, negative ones grow leftward
 * into it.
 */
export function diffBarFill(diff: number): { left: number; width: number } {
  const clamped = Math.max(-1, Math.min(1, diff));
  const width = Math.abs(clamped) * 50;
  const left = clamped >= 0 ? 50 : 50 - width;
  return { left, width };
}
