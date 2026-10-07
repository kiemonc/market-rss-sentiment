import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Chart, type ChartConfiguration, type ChartDataset, type TooltipItem, registerables } from 'chart.js';
import 'chartjs-adapter-date-fns';
import { CandlestickController, CandlestickElement } from 'chartjs-chart-financial';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { SOURCE_COLORS } from './article-stats.util';
import { ArticleService } from './article.service';
import { Candle, PriceService, indexCandles } from './price.service';
import {
  DEFAULT_PRIOR_WEIGHT,
  HOUR_MS,
  SentimentIndexPoint,
  SentimentObservation,
  coinsByCoverage,
  computeSentimentIndex,
  observationsByCoin,
  timeGrid,
} from './sentiment-timeline.util';

Chart.register(...registerables, CandlestickController, CandlestickElement);

const DEFAULT_RANGE_DAYS = 60;
const DEFAULT_COINS = ['BTC'];
const MAX_COINS = SOURCE_COLORS.length; // a 9th series would need a cycled (ambiguous) color
const GRIDLINE_COLOR = '#e1e0d9';
const ZERO_LINE_COLOR = '#9a998f';
/** Muted classic up/down candle colors, used when a single coin's candles carry no identity role. */
const CANDLE_UP = '#1baf7a';
const CANDLE_DOWN = '#e34948';
/** Articles older than this many half-lives before `from` contribute < 2^-5 ≈ 3% and aren't loaded. */
const LOOKBACK_HALF_LIVES = 5;

export const HALF_LIFE_OPTIONS = [
  { label: '6 hours', hours: 6 },
  { label: '12 hours', hours: 12 },
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
];

interface CoinOption {
  coin: string;
  articles: number;
}

interface CandleWithRaw extends Candle {
  /** The original USD candle, kept for the tooltip when the plotted one is indexed to % change. */
  raw: Candle;
}

@Component({
  selector: 'app-sentiment-timeline',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './sentiment-timeline.component.html',
  styleUrl: './sentiment-timeline.component.css',
})
export class SentimentTimelineComponent implements AfterViewInit, OnDestroy {
  private readonly articleService = inject(ArticleService);
  private readonly priceService = inject(PriceService);
  private readonly fb = inject(FormBuilder);

  readonly halfLifeOptions = HALF_LIFE_OPTIONS;
  readonly maxCoins = MAX_COINS;

  readonly filterForm = this.fb.group({
    coins: this.fb.control<string[]>(DEFAULT_COINS),
    from: this.fb.control(isoDaysAgo(DEFAULT_RANGE_DAYS)),
    to: this.fb.control(isoDaysAgo(0)),
    halfLifeHours: this.fb.control(24),
    showPrices: this.fb.control(false),
  });

  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  coinOptions: CoinOption[] = [];
  loading = true;
  /** Selected coins Binance had no USDT price data for, shown as a note under the chart. */
  coinsWithoutPrices: string[] = [];

  private chart?: Chart;
  private loadToken = 0;
  /**
   * Coin -> palette color, assigned on first selection and kept while the coin stays selected,
   * so adding/removing another coin never repaints the ones already on the chart.
   */
  private readonly coinColors = new Map<string, string>();

  async ngAfterViewInit(): Promise<void> {
    this.filterForm.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
      )
      .subscribe(() => this.refresh());

    await this.refresh();
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  isCoinDisabled(coin: string): boolean {
    const selected = this.filterForm.value.coins ?? [];
    return selected.length >= MAX_COINS && !selected.includes(coin);
  }

  colorFor(coin: string): string {
    return this.coinColors.get(coin) ?? 'transparent';
  }

  private assignColors(coins: string[]): void {
    for (const coin of [...this.coinColors.keys()]) {
      if (!coins.includes(coin)) this.coinColors.delete(coin);
    }
    for (const coin of coins) {
      if (this.coinColors.has(coin)) continue;
      const used = new Set(this.coinColors.values());
      this.coinColors.set(coin, SOURCE_COLORS.find((c) => !used.has(c)) ?? SOURCE_COLORS[0]);
    }
  }

  private async refresh(): Promise<void> {
    const { coins, from, to, halfLifeHours, showPrices } = this.filterForm.value;
    if (!from || !to || !halfLifeHours) return;

    const token = ++this.loadToken;
    this.loading = true;

    const halfLifeMs = halfLifeHours * HOUR_MS;
    const fromMs = Date.parse(`${from}T00:00:00.000Z`);
    const toMs = Math.min(Date.parse(`${to}T23:59:59.999Z`), Date.now());
    const lookbackFrom = new Date(fromMs - LOOKBACK_HALF_LIVES * halfLifeMs).toISOString();

    const docs = await this.articleService.getSentimentForRange(lookbackFrom, new Date(toMs).toISOString());
    if (token !== this.loadToken) return;

    const byCoin = observationsByCoin(docs);
    this.coinOptions = mergeSelected(coinsByCoverage(byCoin), coins ?? []);
    const selected = coins ?? [];
    this.assignColors(selected);

    const prices = showPrices
      ? await Promise.all(selected.map((coin) => this.priceService.getCandles(coin, fromMs, toMs)))
      : [];
    if (token !== this.loadToken) return;

    const times = timeGrid(fromMs, toMs);
    const series = selected.map((coin) => ({
      coin,
      points: computeSentimentIndex(byCoin.get(coin) ?? ([] as SentimentObservation[]), times, {
        halfLifeMs,
        priorWeight: DEFAULT_PRIOR_WEIGHT,
      }),
    }));
    const candles = selected
      .map((coin, i) => ({ coin, candles: prices[i] }))
      .filter((p): p is { coin: string; candles: Candle[] } => !!p.candles?.length);
    this.coinsWithoutPrices = showPrices ? selected.filter((c) => !candles.some((p) => p.coin === c)) : [];

    this.chart?.destroy();
    this.chart = new Chart(this.canvasRef.nativeElement, this.buildConfig(series, candles, fromMs, toMs));
    this.loading = false;
  }

  private buildConfig(
    series: { coin: string; points: SentimentIndexPoint[] }[],
    prices: { coin: string; candles: Candle[] }[],
    fromMs: number,
    toMs: number
  ): ChartConfiguration {
    // A single coin's price reads naturally in USD; several coins (BTC vs. DOGE…) only share one
    // right-hand axis meaningfully once indexed to % change from the start of the range.
    const indexed = prices.length > 1;
    const maxAbs = Math.max(0, ...series.flatMap((s) => s.points.map((p) => Math.abs(p.value))));
    const sentimentBound = Math.max(0.25, Math.ceil(maxAbs * 10) / 10);

    const sentimentDatasets: ChartDataset<'line', { x: number; y: number; evidence: number }[]>[] = series.map(
      ({ coin, points }) => ({
        type: 'line',
        label: `${coin} sentiment`,
        data: points.map((p) => ({ x: p.time, y: p.value, evidence: p.evidence })),
        yAxisID: 'ySentiment',
        borderColor: this.colorFor(coin),
        backgroundColor: this.colorFor(coin),
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        tension: 0.2,
        order: 0, // draw on top of the candles
      })
    );

    const candleDatasets = prices.map(({ coin, candles }) => {
      const color = this.colorFor(coin);
      const plotted = indexed ? indexCandles(candles) : candles;
      return {
        type: 'candlestick' as const,
        label: `${coin} price`,
        data: plotted.map((c, i): CandleWithRaw => ({ ...c, raw: candles[i] })),
        yAxisID: 'yPrice',
        // Only used by the legend swatch; the candles themselves use borderColors/backgroundColors.
        borderColor: indexed ? color : CANDLE_UP,
        backgroundColor: indexed ? withAlpha(color, 0.15) : withAlpha(CANDLE_UP, 0.6),
        // One coin: classic green/red. Several: the coin's own color, hollow up / filled down,
        // so each candle still says which coin it belongs to.
        borderColors: indexed
          ? { up: color, down: color, unchanged: color }
          : { up: CANDLE_UP, down: CANDLE_DOWN, unchanged: ZERO_LINE_COLOR },
        backgroundColors: indexed
          ? { up: withAlpha(color, 0.15), down: color, unchanged: color }
          : { up: withAlpha(CANDLE_UP, 0.6), down: withAlpha(CANDLE_DOWN, 0.6), unchanged: ZERO_LINE_COLOR },
        order: 1,
      };
    });

    return {
      type: 'line',
      data: { datasets: [...sentimentDatasets, ...(candleDatasets as unknown as ChartDataset<'line'>[])] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        animation: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: {
          x: {
            type: 'time',
            min: fromMs,
            max: toMs,
            offset: false,
            grid: { display: false },
            ticks: { maxRotation: 0, autoSkipPadding: 24 },
          },
          ySentiment: {
            type: 'linear',
            position: 'left',
            min: -sentimentBound,
            max: sentimentBound,
            title: { display: true, text: 'Sentiment index (bearish ← 0 → bullish)' },
            grid: {
              color: (ctx) => (ctx.tick.value === 0 ? ZERO_LINE_COLOR : GRIDLINE_COLOR),
              lineWidth: (ctx) => (ctx.tick.value === 0 ? 1.5 : 1),
            },
          },
          yPrice: {
            type: 'linear',
            position: 'right',
            display: prices.length > 0,
            title: { display: true, text: indexed ? 'Price change since start (%)' : `${prices[0]?.coin ?? ''} price (USDT)` },
            grid: { drawOnChartArea: false },
            ticks: {
              callback: (value) => (indexed ? `${formatSigned(+value)}%` : formatUsd(+value)),
            },
          },
        },
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true } },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              title: (items) => (items[0] ? new Date(items[0].parsed.x as number).toLocaleString() : ''),
              label: (item) => tooltipLabel(item),
            },
          },
        },
      },
    };
  }
}

function tooltipLabel(item: TooltipItem<keyof import('chart.js').ChartTypeRegistry>): string {
  const raw = item.raw as { y?: number; evidence?: number; raw?: Candle };
  if (raw.raw) {
    const { o, h, l, c } = raw.raw;
    return `${item.dataset.label}: O ${formatUsd(o)}  H ${formatUsd(h)}  L ${formatUsd(l)}  C ${formatUsd(c)}`;
  }
  return `${item.dataset.label}: ${formatSigned(raw.y ?? 0, 2)} (≈${(raw.evidence ?? 0).toFixed(1)} articles of evidence)`;
}

/** Keeps currently selected coins in the dropdown even if the new date range has no articles for them. */
function mergeSelected(options: CoinOption[], selected: string[]): CoinOption[] {
  const missing = selected.filter((coin) => !options.some((o) => o.coin === coin)).map((coin) => ({ coin, articles: 0 }));
  return [...options, ...missing];
}

function formatSigned(value: number, digits = 0): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function formatUsd(value: number): string {
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 1 ? 2 : 4;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
