import { SentimentAnalysis } from './article.model';

/**
 * One coin's sentiment reading from one article, placed at the article's publication time.
 * `value` is the LLM's signed `sentimentDiff` in [-1,1]; `weight` is its relevance in [0,1].
 */
export interface SentimentObservation {
  time: number;
  value: number;
  weight: number;
  /** The source article, for linking a chart point back to it. Not used by the index itself. */
  articleId?: string;
  title?: string;
}

export interface SentimentIndexOptions {
  /** Time after which an article's influence on the index has halved, in ms. */
  halfLifeMs: number;
  /**
   * Weight of an implicit neutral (0) reading that's always present, in "fully relevant
   * articles". Keeps one weakly relevant article from swinging the index to ±1 on its own, and
   * pulls the index back to neutral as evidence decays during periods with no news.
   */
  priorWeight: number;
}

export const DEFAULT_PRIOR_WEIGHT = 0.5;

export interface SentimentIndexPoint {
  time: number;
  /** Sentiment index in [-1,1]: positive = bullish, negative = bearish. */
  value: number;
  /** Total decayed relevance backing `value` — roughly "how many fully relevant recent articles". */
  evidence: number;
}

/**
 * Time-decayed, relevance-weighted sentiment index — evaluated at every time in `times`:
 *
 *   S(t) = Σ wᵢ·sᵢ·dᵢ(t) / (k + Σ wᵢ·dᵢ(t)),   dᵢ(t) = 2^(−(t − tᵢ)/H),  over articles with tᵢ ≤ t
 *
 * where sᵢ = sentimentDiff, wᵢ = relevance weight, H = half-life and k = prior weight. Only
 * articles published at or before t count, so the index never "knows" the future — which matters
 * when it's read alongside price candles.
 *
 * `observations` must be sorted by `time` ascending; `times` must be ascending too. Runs in
 * O(observations + times) by carrying both decayed sums forward between consecutive times.
 */
export function computeSentimentIndex(
  observations: SentimentObservation[],
  times: number[],
  { halfLifeMs, priorWeight }: SentimentIndexOptions
): SentimentIndexPoint[] {
  const points: SentimentIndexPoint[] = [];
  let weightedSum = 0;
  let weightSum = 0;
  let sumsAt = -Infinity; // time the two running sums are currently decayed to
  let next = 0;

  for (const t of times) {
    // Fold in every observation up to t, decaying the running sums to each one's time first.
    while (next < observations.length && observations[next].time <= t) {
      const { time, value, weight } = observations[next++];
      const decay = sumsAt === -Infinity ? 0 : Math.pow(2, -(time - sumsAt) / halfLifeMs);
      const clamped = Math.max(-1, Math.min(1, value));
      weightedSum = weightedSum * decay + weight * clamped;
      weightSum = weightSum * decay + weight;
      sumsAt = time;
    }
    if (sumsAt !== -Infinity && t > sumsAt) {
      const decay = Math.pow(2, -(t - sumsAt) / halfLifeMs);
      weightedSum *= decay;
      weightSum *= decay;
      sumsAt = t;
    }
    points.push({ time: t, value: weightedSum / (priorWeight + weightSum), evidence: weightSum });
  }
  return points;
}

/** Per-coin observations from a batch of sentiment docs, each coin's list sorted by time. */
export function observationsByCoin(docs: SentimentAnalysis[]): Map<string, SentimentObservation[]> {
  const byCoin = new Map<string, SentimentObservation[]>();
  for (const doc of docs) {
    if (!doc.publishedAt) continue;
    const time = Date.parse(doc.publishedAt);
    if (isNaN(time)) continue;
    for (const [coin, s] of Object.entries(doc.coins ?? {})) {
      if (typeof s?.sentimentDiff !== 'number' || typeof s.weight !== 'number' || s.weight <= 0) continue;
      let list = byCoin.get(coin);
      if (!list) byCoin.set(coin, (list = []));
      list.push({ time, value: s.sentimentDiff, weight: s.weight, articleId: doc.articleId, title: doc.title });
    }
  }
  for (const list of byCoin.values()) list.sort((a, b) => a.time - b.time);
  return byCoin;
}

/** Coins ordered by how much total relevance they carry across `byCoin`, most covered first. */
export function coinsByCoverage(byCoin: Map<string, SentimentObservation[]>): { coin: string; articles: number }[] {
  return [...byCoin.entries()]
    .map(([coin, obs]) => ({ coin, articles: obs.length, total: obs.reduce((sum, o) => sum + o.weight, 0) }))
    .sort((a, b) => b.total - a.total || a.coin.localeCompare(b.coin))
    .map(({ coin, articles }) => ({ coin, articles }));
}

export const HOUR_MS = 3_600_000;

/** Evaluation-grid steps to choose from; the smallest one that keeps the grid under `maxPoints` wins. */
const GRID_STEPS_MS = [1, 2, 4, 6, 12, 24, 48, 168].map((h) => h * HOUR_MS);

/**
 * `grid` plus the publication time of every observation within [from, to], sorted and deduped —
 * evaluating the index at these times makes the plotted line step exactly where each article
 * lands, so the per-article points drawn at (time, index value) sit on the line.
 */
export function withObservationTimes(grid: number[], observations: SentimentObservation[], from: number, to: number): number[] {
  const times = new Set(grid);
  for (const { time } of observations) if (time >= from && time <= to) times.add(time);
  return [...times].sort((a, b) => a - b);
}

/** Evenly spaced, step-aligned times covering [from, to], at the finest step yielding ≤ maxPoints. */
export function timeGrid(from: number, to: number, maxPoints = 400): number[] {
  const step = GRID_STEPS_MS.find((s) => (to - from) / s <= maxPoints) ?? GRID_STEPS_MS.at(-1)!;
  const times: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) times.push(t);
  return times;
}
