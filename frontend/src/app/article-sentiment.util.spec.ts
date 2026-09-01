import { CoinSentiment } from './article.model';
import { diffBarFill, sentimentDirection, sortedCoinEntries, toPercent } from './article-sentiment.util';

function coin(overrides: Partial<CoinSentiment>): CoinSentiment {
  return { vector: [0.5, 0.3, 0.2], weight: 0.5, sentimentDiff: 0, ...overrides };
}

describe('sortedCoinEntries', () => {
  it('orders coins by weight, most relevant first', () => {
    const coins = { ETH: coin({ weight: 0.4 }), BTC: coin({ weight: 0.9 }), SOL: coin({ weight: 0.1 }) };

    expect(sortedCoinEntries(coins).map(([ticker]) => ticker)).toEqual(['BTC', 'ETH', 'SOL']);
  });

  it('returns an empty array for an empty coin map', () => {
    expect(sortedCoinEntries({})).toEqual([]);
  });
});

describe('toPercent', () => {
  it('converts a [0,1] fraction to a rounded whole-number percentage', () => {
    expect(toPercent(0.873)).toBe(87);
    expect(toPercent(0)).toBe(0);
    expect(toPercent(1)).toBe(100);
  });

  it('clamps out-of-range values', () => {
    expect(toPercent(-0.2)).toBe(0);
    expect(toPercent(1.5)).toBe(100);
  });
});

describe('sentimentDirection', () => {
  it('classifies clearly positive diffs as bullish', () => {
    expect(sentimentDirection(0.5)).toBe('bullish');
  });

  it('classifies clearly negative diffs as bearish', () => {
    expect(sentimentDirection(-0.5)).toBe('bearish');
  });

  it('classifies near-zero diffs as neutral', () => {
    expect(sentimentDirection(0.02)).toBe('neutral');
    expect(sentimentDirection(-0.02)).toBe('neutral');
    expect(sentimentDirection(0)).toBe('neutral');
  });
});

describe('diffBarFill', () => {
  it('grows rightward from center for a positive diff', () => {
    expect(diffBarFill(0.5)).toEqual({ left: 50, width: 25 });
  });

  it('grows leftward into center for a negative diff', () => {
    expect(diffBarFill(-0.5)).toEqual({ left: 25, width: 25 });
  });

  it('produces no fill for a zero diff', () => {
    expect(diffBarFill(0)).toEqual({ left: 50, width: 0 });
  });

  it('clamps out-of-range diffs to the [-1,1] track', () => {
    expect(diffBarFill(2)).toEqual({ left: 50, width: 50 });
    expect(diffBarFill(-2)).toEqual({ left: 0, width: 50 });
  });
});
