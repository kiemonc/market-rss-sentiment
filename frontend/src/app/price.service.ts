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
const MAX_CANDLES = 1000; // Binance's per-request cap.

const INTERVALS: { name: string; ms: number }[] = [
  { name: '1h', ms: HOUR_MS },
  { name: '4h', ms: 4 * HOUR_MS },
  { name: '1d', ms: 24 * HOUR_MS },
  { name: '1w', ms: 168 * HOUR_MS },
];

/**
 * Candle interval for a [from, to] range: the finest one that keeps the chart readable
 * (≤ ~120 candles), so candles stay wide enough to see their bodies and wicks.
 */
export function candleIntervalFor(from: number, to: number): { name: string; ms: number } {
  return INTERVALS.find((i) => (to - from) / i.ms <= 120) ?? INTERVALS.at(-1)!;
}

@Injectable({ providedIn: 'root' })
export class PriceService {
  /**
   * USDT-quoted OHLC candles for `coin` over [from, to], or null if Binance has no `<coin>USDT`
   * pair (stablecoins like USDT itself, small caps not listed there) or the request fails.
   */
  async getCandles(coin: string, from: number, to: number): Promise<Candle[] | null> {
    const interval = candleIntervalFor(from, to);
    const params = new URLSearchParams({
      symbol: `${coin.toUpperCase()}USDT`,
      interval: interval.name,
      startTime: String(from),
      endTime: String(to),
      limit: String(MAX_CANDLES),
    });
    try {
      const response = await fetch(`${KLINES_URL}?${params}`);
      if (!response.ok) return null;
      const rows = (await response.json()) as [number, string, string, string, string][];
      return rows.map(([x, o, h, l, c]) => ({ x, o: +o, h: +h, l: +l, c: +c }));
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
