import { Injectable } from '@angular/core';
import { HOUR_MS } from './sentiment-timeline.util';

export interface Candle {
  /** Candle open time, ms since epoch. */
  x: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

/**
 * Binance's public market-data mirror: no API key, CORS-enabled (`Access-Control-Allow-Origin: *`)
 * and — unlike api.binance.com — not geo-blocked, so the browser can call it directly.
 */
const KLINES_URL = 'https://data-api.binance.vision/api/v3/klines';
const PAGE_SIZE = 1000; // Binance's per-request cap.
/** Upper bound on candles per coin per chart; finer intervals than this allows are disabled in the UI. */
export const MAX_CANDLES = 5000;

export type CandleIntervalName = '15m' | '1h' | '4h' | '1d' | '1w';

export interface CandleInterval {
  name: CandleIntervalName;
  /** Toolbar label, TradingView-style. */
  label: string;
  ms: number;
}

export const CANDLE_INTERVALS: CandleInterval[] = [
  { name: '15m', label: '15m', ms: HOUR_MS / 4 },
  { name: '1h', label: '1H', ms: HOUR_MS },
  { name: '4h', label: '4H', ms: 4 * HOUR_MS },
  { name: '1d', label: '1D', ms: 24 * HOUR_MS },
  { name: '1w', label: '1W', ms: 168 * HOUR_MS },
];

/**
 * Candle interval for a [from, to] range: the finest one that keeps the chart readable
 * (≤ ~120 candles), so candles stay wide enough to see their bodies and wicks.
 */
export function candleIntervalFor(from: number, to: number): CandleInterval {
  return CANDLE_INTERVALS.find((i) => (to - from) / i.ms <= 120) ?? CANDLE_INTERVALS.at(-1)!;
}

/** Whether `interval` would need more than MAX_CANDLES candles to cover [from, to]. */
export function exceedsCandleLimit(interval: CandleInterval, from: number, to: number): boolean {
  return (to - from) / interval.ms > MAX_CANDLES;
}

@Injectable({ providedIn: 'root' })
export class PriceService {
  private readonly cache = new Map<string, Promise<Candle[] | null>>();

  /**
   * USDT-quoted OHLC candles for `coin` over [from, to] at `interval`, or null if Binance has no
   * `<coin>USDT` pair (stablecoins like USDT itself, small caps not listed there) or the request
   * fails. Pages through Binance's 1000-candle limit; results are cached per arguments, so
   * toggling display options doesn't refetch.
   */
  getCandles(coin: string, from: number, to: number, interval: CandleInterval): Promise<Candle[] | null> {
    const key = `${coin}|${interval.name}|${from}|${to}`;
    let result = this.cache.get(key);
    if (!result) {
      result = this.fetchCandles(coin, from, to, interval);
      this.cache.set(key, result);
      // Don't cache failures: a later retry may well succeed.
      result.then((candles) => candles === null && this.cache.delete(key));
    }
    return result;
  }

  private async fetchCandles(coin: string, from: number, to: number, interval: CandleInterval): Promise<Candle[] | null> {
    const candles: Candle[] = [];
    let start = from;
    try {
      while (start <= to && candles.length < MAX_CANDLES) {
        const params = new URLSearchParams({
          symbol: `${coin.toUpperCase()}USDT`,
          interval: interval.name,
          startTime: String(start),
          endTime: String(to),
          limit: String(PAGE_SIZE),
        });
        const response = await fetch(`${KLINES_URL}?${params}`);
        if (!response.ok) return null;
        const rows = (await response.json()) as [number, string, string, string, string][];
        candles.push(...rows.map(([x, o, h, l, c]) => ({ x, o: +o, h: +h, l: +l, c: +c })));
        if (rows.length < PAGE_SIZE) break;
        start = rows[rows.length - 1][0] + interval.ms;
      }
      return candles;
    } catch (err) {
      console.warn(`Failed to load ${coin} prices:`, err);
      return null;
    }
  }
}

/** Rescales candles to % change from the first candle's open, so coins of very different prices share one axis. */
export function indexCandles(candles: Candle[]): Candle[] {
  const base = candles[0]?.o;
  if (!base) return candles;
  const pct = (v: number) => (v / base - 1) * 100;
  return candles.map(({ x, o, h, l, c }) => ({ x, o: pct(o), h: pct(h), l: pct(l), c: pct(c) }));
}
