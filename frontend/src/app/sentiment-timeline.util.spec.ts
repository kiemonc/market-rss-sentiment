import { SentimentAnalysis } from './article.model';
import { candleIntervalFor, indexCandles } from './price.service';
import {
  coinsByCoverage,
  computeSentimentIndex,
  HOUR_MS,
  observationsByCoin,
  timeGrid,
  withObservationTimes,
} from './sentiment-timeline.util';

const OPTIONS = { halfLifeMs: 10 * HOUR_MS, priorWeight: 0.5 };

describe('computeSentimentIndex', () => {
  it('is neutral with no evidence', () => {
    expect(computeSentimentIndex([], [0, HOUR_MS], OPTIONS)).toEqual([
      { time: 0, value: 0, evidence: 0 },
      { time: HOUR_MS, value: 0, evidence: 0 },
    ]);
  });

  it('shrinks a single article toward neutral by the prior weight', () => {
    const [point] = computeSentimentIndex([{ time: 0, value: 1, weight: 1 }], [0], OPTIONS);
    expect(point.value).toBeCloseTo(1 / 1.5);
    expect(point.evidence).toBe(1);
  });

  it('ignores articles published after the evaluation time', () => {
    const points = computeSentimentIndex([{ time: 5 * HOUR_MS, value: 1, weight: 1 }], [0, 5 * HOUR_MS], OPTIONS);
    expect(points[0].value).toBe(0);
    expect(points[1].value).toBeGreaterThan(0);
  });

  it('halves an article’s evidence after one half-life, decaying the index toward neutral', () => {
    const points = computeSentimentIndex([{ time: 0, value: 1, weight: 1 }], [0, 10 * HOUR_MS], OPTIONS);
    expect(points[1].evidence).toBeCloseTo(0.5);
    expect(points[1].value).toBeCloseTo(0.5 / 1.0);
    expect(points[1].value).toBeLessThan(points[0].value);
  });

  it('weights articles by relevance, so a relevant bearish article outweighs a marginal bullish one', () => {
    const [point] = computeSentimentIndex(
      [
        { time: 0, value: 1, weight: 0.1 },
        { time: 0, value: -1, weight: 0.9 },
      ],
      [0],
      OPTIONS
    );
    expect(point.value).toBeCloseTo(-0.8 / 1.5);
  });

  it('matches the closed-form sum when several articles arrive between grid points', () => {
    const obs = [
      { time: 0, value: 0.4, weight: 0.5 },
      { time: 3 * HOUR_MS, value: -0.2, weight: 1 },
      { time: 7 * HOUR_MS, value: 0.9, weight: 0.8 },
    ];
    const t = 12 * HOUR_MS;
    const d = (ti: number) => Math.pow(2, -(t - ti) / OPTIONS.halfLifeMs);
    const num = obs.reduce((s, o) => s + o.weight * o.value * d(o.time), 0);
    const den = obs.reduce((s, o) => s + o.weight * d(o.time), 0);

    const [point] = computeSentimentIndex(obs, [t], OPTIONS);
    expect(point.value).toBeCloseTo(num / (OPTIONS.priorWeight + den));
    expect(point.evidence).toBeCloseTo(den);
  });

  it('clamps out-of-range sentiment values', () => {
    const [point] = computeSentimentIndex([{ time: 0, value: 5, weight: 1 }], [0], { ...OPTIONS, priorWeight: 0 });
    expect(point.value).toBe(1);
  });
});

describe('observationsByCoin / coinsByCoverage', () => {
  const doc = (publishedAt: string | undefined, coins: SentimentAnalysis['coins']): SentimentAnalysis => ({
    articleId: 'a',
    source: 's',
    analyzedAt: '2026-01-01T00:00:00.000Z',
    publishedAt,
    coins,
  });

  it('groups readings per coin sorted by time, skipping docs without publishedAt', () => {
    const byCoin = observationsByCoin([
      doc('2026-01-02T00:00:00.000Z', { BTC: { vector: [1, 0, 0], weight: 0.9, sentimentDiff: 0.3 } }),
      doc('2026-01-01T00:00:00.000Z', {
        BTC: { vector: [0, 1, 0], weight: 0.5, sentimentDiff: -0.2 },
        ETH: { vector: [0, 0, 1], weight: 0.2, sentimentDiff: 0 },
      }),
      doc(undefined, { SOL: { vector: [1, 0, 0], weight: 1, sentimentDiff: 1 } }),
    ]);

    expect(byCoin.get('BTC')!.map((o) => o.value)).toEqual([-0.2, 0.3]);
    expect(byCoin.get('BTC')![0].articleId).toBe('a');
    expect(byCoin.has('SOL')).toBeFalse();
    expect(coinsByCoverage(byCoin)).toEqual([
      { coin: 'BTC', articles: 2 },
      { coin: 'ETH', articles: 1 },
    ]);
  });
});

describe('withObservationTimes', () => {
  it('merges in-range observation times into the grid, sorted and deduped', () => {
    const obs = [
      { time: -1, value: 0, weight: 1 },
      { time: HOUR_MS, value: 0, weight: 1 },
      { time: 1.5 * HOUR_MS, value: 0, weight: 1 },
      { time: 9 * HOUR_MS, value: 0, weight: 1 },
    ];
    expect(withObservationTimes([0, HOUR_MS, 2 * HOUR_MS], obs, 0, 2 * HOUR_MS)).toEqual([
      0,
      HOUR_MS,
      1.5 * HOUR_MS,
      2 * HOUR_MS,
    ]);
  });
});

describe('timeGrid', () => {
  it('uses hourly steps for short ranges, aligned to the step', () => {
    const grid = timeGrid(30 * 60_000, 3 * HOUR_MS);
    expect(grid).toEqual([HOUR_MS, 2 * HOUR_MS, 3 * HOUR_MS]);
  });

  it('coarsens the step to stay under the point budget', () => {
    expect(timeGrid(0, 60 * 24 * HOUR_MS).length).toBeLessThanOrEqual(400);
  });
});

describe('candleIntervalFor / indexCandles', () => {
  it('picks daily candles for a month-long range', () => {
    expect(candleIntervalFor(0, 30 * 24 * HOUR_MS).name).toBe('1d');
    expect(candleIntervalFor(0, 3 * 24 * HOUR_MS).name).toBe('1h');
  });

  it('rescales candles to % change from the first open', () => {
    const [candle] = indexCandles([{ x: 0, o: 100, h: 110, l: 90, c: 105 }]);
    expect(candle.o).toBe(0);
    expect(candle.h).toBeCloseTo(10);
    expect(candle.l).toBeCloseTo(-10);
    expect(candle.c).toBeCloseTo(5);
  });
});
