import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, effect, inject, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import {
  Chart,
  type ChartConfiguration,
  type ChartDataset,
  type ChartEvent,
  Interaction,
  type InteractionItem,
  type InteractionModeFunction,
  type Plugin,
  type TooltipItem,
  registerables,
} from 'chart.js';
import { getRelativePosition } from 'chart.js/helpers';
import 'chartjs-adapter-date-fns';
import { enUS, pl } from 'date-fns/locale';
import { CandlestickController, CandlestickElement } from 'chartjs-chart-financial';
import zoomPlugin from 'chartjs-plugin-zoom';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { SOURCE_COLORS } from './article-stats.util';
import { ArticleService } from './article.service';
import { I18nService, TranslatePipe } from './i18n/i18n.service';
import { TranslationKey } from './i18n/translations';
import { SentimentAnalysis } from './article.model';
import {
  CANDLE_INTERVALS,
  Candle,
  CandleInterval,
  CandleIntervalName,
  PriceService,
  candleIntervalFor,
  exceedsCandleLimit,
  indexCandles,
} from './price.service';
import {
  DEFAULT_PRIOR_WEIGHT,
  HOUR_MS,
  SentimentIndexPoint,
  SentimentObservation,
  coinsByCoverage,
  computeSentimentIndex,
  observationsByCoin,
  timeGrid,
  withObservationTimes,
} from './sentiment-timeline.util';

Chart.register(...registerables, CandlestickController, CandlestickElement, zoomPlugin);

declare module 'chart.js' {
  interface InteractionModeMap {
    nearestPerDataset: InteractionModeFunction;
  }
}

/**
 * Tooltip/hover mode for this chart's mix of series with different x positions (sentiment lines
 * on a grid, candles per interval, articles at their publish times), where Chart.js's 'index'
 * mode would pair up unrelated points by array index. Takes the x-nearest element of every
 * continuous series, plus any article points actually under the pointer.
 */
Interaction.modes.nearestPerDataset = (chart, e, _options, useFinalPosition) => {
  const pos = getRelativePosition(e, chart);
  const { left, right, top, bottom } = chart.chartArea;
  if (pos.x < left || pos.x > right || pos.y < top || pos.y > bottom) return [];

  const items: InteractionItem[] = [];
  chart.data.datasets.forEach((dataset, datasetIndex) => {
    if (!chart.isDatasetVisible(datasetIndex)) return;
    const elements = chart.getDatasetMeta(datasetIndex).data;
    if (isArticleDataset(dataset)) {
      elements.forEach((element, index) => {
        const { x, y } = element.getProps(['x', 'y'], useFinalPosition);
        if (Math.hypot(x - pos.x, y - pos.y) <= ARTICLE_HIT_RADIUS) items.push({ element, datasetIndex, index });
      });
      return;
    }
    let best = -1;
    let bestDistance = Infinity;
    elements.forEach((element, index) => {
      const distance = Math.abs(element.getProps(['x'], useFinalPosition)['x'] - pos.x);
      if (distance < bestDistance) [best, bestDistance] = [index, distance];
    });
    if (best >= 0) items.push({ element: elements[best], datasetIndex, index: best });
  });
  return items;
};

const DEFAULT_RANGE_DAYS = 90; // = the 3M toolbar preset
/** Quick-range toolbar presets, TradingView-style. */
export const RANGE_PRESETS = [
  { label: '1D', days: 1 },
  { label: '1W', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 182 },
  { label: '1Y', days: 365 },
];
/** Narrowest time span the chart can be zoomed into. */
const MIN_ZOOM_RANGE_MS = 2 * HOUR_MS;
/** A click this soon after a pan ends is the tail of the drag, not a click on an article. */
const CLICK_AFTER_PAN_GRACE_MS = 250;
const CROSSHAIR_COLOR = '#787b86';
const CROSSHAIR_LABEL_BG = '#131722';
const CROSSHAIR_LABEL_TEXT = '#ffffff';
const DEFAULT_COINS = ['BTC'];
const MAX_COINS = SOURCE_COLORS.length; // a 9th series would need a cycled (ambiguous) color
const GRIDLINE_COLOR = '#e1e0d9';
const ZERO_LINE_COLOR = '#9a998f';
/** Muted classic up/down candle colors, used when a single coin's candles carry no identity role. */
const CANDLE_UP = '#1baf7a';
const CANDLE_DOWN = '#e34948';
/** Pointer distance (px) within which an article point counts as hovered/clicked. */
const ARTICLE_HIT_RADIUS = 8;
const ARTICLE_POINT_BORDER = '#ffffff';
/** Articles older than this many half-lives before `from` contribute < 2^-5 ≈ 3% and aren't loaded. */
const LOOKBACK_HALF_LIVES = 5;

/** Half-life choices in hours; each has a `timeline.halfLife.<hours>` label. */
export const HALF_LIFE_OPTIONS = [6, 12, 24, 72, 168] as const;

type DatasetKind = 'sentiment' | 'articles' | 'price';

interface CoinOption {
  coin: string;
  articles: number;
}

interface ArticlePoint {
  x: number;
  /** The index value right after this article was folded in, so the point sits on the line. */
  y: number;
  articleId: string;
  title?: string;
  impact: number;
  relevance: number;
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
    MatProgressSpinnerModule,
    TranslatePipe,
  ],
  templateUrl: './sentiment-timeline.component.html',
  styleUrl: './sentiment-timeline.component.css',
})
export class SentimentTimelineComponent implements AfterViewInit, OnDestroy {
  private readonly articleService = inject(ArticleService);
  private readonly priceService = inject(PriceService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);

  readonly halfLifeOptions = HALF_LIFE_OPTIONS;
  readonly maxCoins = MAX_COINS;

  readonly filterForm = this.fb.group({
    coins: this.fb.control<string[]>(DEFAULT_COINS),
    from: this.fb.control(isoDaysAgo(DEFAULT_RANGE_DAYS)),
    to: this.fb.control(isoDaysAgo(0)),
    halfLifeHours: this.fb.control(24),
    showPrices: this.fb.control(true),
    showSentiment: this.fb.control(true),
    showArticles: this.fb.control(true),
    candleInterval: this.fb.control<CandleIntervalName | 'auto'>('auto'),
  });

  readonly rangePresets = RANGE_PRESETS;
  readonly candleIntervals = CANDLE_INTERVALS;
  /** The interval actually used for the current candles (resolves 'auto'). */
  effectiveInterval?: CandleInterval;
  /** Whether the chart is zoomed/panned away from the full selected range. */
  zoomed = false;

  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  coinOptions: CoinOption[] = [];
  loading = true;
  /** Selected coins Binance had no USDT price data for, shown as a note under the chart. */
  coinsWithoutPrices: string[] = [];

  private chart?: Chart;
  private loadToken = 0;
  private lastPanEnd = 0;
  /** Sentiment docs per (lookback-from, to) query, so display-only changes don't refetch. */
  private readonly sentimentCache = new Map<string, Promise<SentimentAnalysis[]>>();
  /**
   * Coin -> palette color, assigned on first selection and kept while the coin stays selected,
   * so adding/removing another coin never repaints the ones already on the chart.
   */
  private readonly coinColors = new Map<string, string>();

  private viewReady = false;

  constructor() {
    // Axis titles, legend and tooltips are drawn on the canvas, so a language switch must rebuild
    // the chart (cheap: data comes from the caches).
    effect(() => {
      this.i18n.lang();
      if (this.viewReady) untracked(() => this.refresh());
    });
  }

  halfLifeKey(hours: number): TranslationKey {
    return `timeline.halfLife.${hours}` as TranslationKey;
  }

  async ngAfterViewInit(): Promise<void> {
    this.viewReady = true;
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

  setRange(days: number): void {
    this.filterForm.patchValue({ from: isoDaysAgo(days), to: isoDaysAgo(0) });
  }

  isRangeActive(days: number): boolean {
    const { from, to } = this.filterForm.value;
    return from === isoDaysAgo(days) && to === isoDaysAgo(0);
  }

  setCandleInterval(interval: CandleIntervalName | 'auto'): void {
    this.filterForm.patchValue({ candleInterval: interval, showPrices: true });
  }

  /** Intervals that would need more candles than we fetch for the selected range are disabled. */
  isIntervalDisabled(interval: CandleInterval): boolean {
    const range = this.selectedRange();
    return !range || exceedsCandleLimit(interval, range.fromMs, range.toMs);
  }

  toggle(control: 'showPrices' | 'showSentiment' | 'showArticles'): void {
    this.filterForm.controls[control].setValue(!this.filterForm.controls[control].value);
  }

  resetZoom(): void {
    this.chart?.resetZoom();
    this.zoomed = false;
  }

  private selectedRange(): { fromMs: number; toEndMs: number; toMs: number } | null {
    const { from, to } = this.filterForm.value;
    if (!from || !to) return null;
    const fromMs = Date.parse(`${from}T00:00:00.000Z`);
    const toEndMs = Date.parse(`${to}T23:59:59.999Z`);
    if (isNaN(fromMs) || isNaN(toEndMs) || toEndMs <= fromMs) return null;
    return { fromMs, toEndMs, toMs: Math.min(toEndMs, Date.now()) };
  }

  private getSentiment(fromIso: string, toIso: string): Promise<SentimentAnalysis[]> {
    const key = `${fromIso}|${toIso}`;
    let result = this.sentimentCache.get(key);
    if (!result) {
      result = this.articleService.getSentimentForRange(fromIso, toIso);
      this.sentimentCache.set(key, result);
      result.catch(() => this.sentimentCache.delete(key));
    }
    return result;
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
    const { coins, halfLifeHours, showPrices, showSentiment, showArticles, candleInterval } = this.filterForm.value;
    const range = this.selectedRange();
    if (!range || !halfLifeHours) return;
    const { fromMs, toEndMs, toMs } = range;

    const token = ++this.loadToken;
    this.loading = true;

    const halfLifeMs = halfLifeHours * HOUR_MS;
    const lookbackFrom = new Date(fromMs - LOOKBACK_HALF_LIVES * halfLifeMs).toISOString();

    const docs = await this.getSentiment(lookbackFrom, new Date(toEndMs).toISOString());
    if (token !== this.loadToken) return;

    const byCoin = observationsByCoin(docs);
    this.coinOptions = mergeSelected(coinsByCoverage(byCoin), coins ?? []);
    const selected = coins ?? [];
    this.assignColors(selected);

    const chosen = CANDLE_INTERVALS.find((i) => i.name === candleInterval);
    // An explicit interval that the (possibly since widened) range can't afford falls back to auto.
    this.effectiveInterval =
      chosen && !exceedsCandleLimit(chosen, fromMs, toMs) ? chosen : candleIntervalFor(fromMs, toMs);
    const interval = this.effectiveInterval;
    const prices = showPrices
      ? await Promise.all(selected.map((coin) => this.priceService.getCandles(coin, fromMs, toEndMs, interval)))
      : [];
    if (token !== this.loadToken) return;

    const grid = timeGrid(fromMs, toMs);
    const series = selected.map((coin) => {
      const observations = byCoin.get(coin) ?? ([] as SentimentObservation[]);
      const points = computeSentimentIndex(observations, withObservationTimes(grid, observations, fromMs, toMs), {
        halfLifeMs,
        priorWeight: DEFAULT_PRIOR_WEIGHT,
      });
      return { coin, points, articles: articlePoints(observations, points, fromMs, toMs) };
    });
    const candles = selected
      .map((coin, i) => ({ coin, candles: prices[i] }))
      .filter((p): p is { coin: string; candles: Candle[] } => !!p.candles?.length);
    this.coinsWithoutPrices = showPrices ? selected.filter((c) => !candles.some((p) => p.coin === c)) : [];

    // Keep the user's zoom when only what's displayed changed, not the date range itself.
    const previous = this.chart;
    const keepZoom =
      previous?.isZoomedOrPanned() && previous.options.scales?.['x']?.min === fromMs && previous.options.scales?.['x']?.max === toMs
        ? { min: previous.scales['x'].min, max: previous.scales['x'].max }
        : null;
    previous?.destroy();
    this.chart = new Chart(
      this.canvasRef.nativeElement,
      this.buildConfig(
        showSentiment === false ? [] : series,
        showArticles === false ? [] : series,
        candles,
        fromMs,
        toMs
      )
    );
    if (keepZoom) this.chart.zoomScale('x', keepZoom, 'none');
    this.zoomed = !!keepZoom;

    this.loading = false;
  }

  private tooltipLabel(item: TooltipItem<keyof import('chart.js').ChartTypeRegistry>): string {
    const t = this.i18n.t.bind(this.i18n);
    const raw = item.raw as { y?: number; evidence?: number; raw?: Candle } & Partial<ArticlePoint>;
    if (raw.articleId) {
      const title = raw.title ?? t('timeline.tooltip.untitled');
      const shortTitle = title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
      return t('timeline.tooltip.article', {
        coin: (item.dataset as { coin?: string }).coin ?? '',
        title: shortTitle,
        impact: formatSigned(raw.impact ?? 0, 2),
        relevance: Math.round((raw.relevance ?? 0) * 100),
      });
    }
    if (raw.raw) {
      const { o, h, l, c } = raw.raw;
      return `${item.dataset.label}: O ${formatUsd(o)}  H ${formatUsd(h)}  L ${formatUsd(l)}  C ${formatUsd(c)}`;
    }
    return t('timeline.tooltip.sentiment', {
      label: item.dataset.label ?? '',
      value: formatSigned(raw.y ?? 0, 2),
      evidence: (raw.evidence ?? 0).toFixed(1),
    });
  }

  private openArticle(event: ChartEvent, articles: ArticlePoint[]): void {
    if (!articles.length || Date.now() - this.lastPanEnd < CLICK_AFTER_PAN_GRACE_MS) return;
    const url = this.router.serializeUrl(this.router.createUrlTree(['/articles', articles[0].articleId]));
    const native = event.native as MouseEvent | null;
    if (native?.ctrlKey || native?.metaKey) {
      window.open(url, '_blank');
    } else {
      this.router.navigateByUrl(url);
    }
  }

  private buildConfig(
    series: { coin: string; points: SentimentIndexPoint[] }[],
    articleSeries: { coin: string; articles: ArticlePoint[] }[],
    prices: { coin: string; candles: Candle[] }[],
    fromMs: number,
    toMs: number
  ): ChartConfiguration {
    // A single coin's price reads naturally in USD; several coins (BTC vs. DOGE…) only share one
    // right-hand axis meaningfully once indexed to % change from the start of the range.
    const indexed = prices.length > 1;
    const t = this.i18n.t.bind(this.i18n);
    const locale = this.i18n.locale();
    const maxAbs = Math.max(0, ...series.flatMap((s) => s.points.map((p) => Math.abs(p.value))));
    const sentimentBound = Math.max(0.25, Math.ceil(maxAbs * 10) / 10);

    const sentimentDatasets: ChartDataset<'line', { x: number; y: number; evidence: number }[]>[] = series.map(
      ({ coin, points }) => ({
        type: 'line',
        label: t('timeline.dataset.sentiment', { coin }),
        kind: 'sentiment' as DatasetKind,
        coin,
        data: points.map((p) => ({ x: p.time, y: p.value, evidence: p.evidence })),
        yAxisID: 'ySentiment',
        borderColor: this.colorFor(coin),
        backgroundColor: this.colorFor(coin),
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        tension: 0, // the index jumps at each article; smoothing would overshoot around those steps
        order: 0, // draw on top of the candles
      })
    );

    const articleDatasets: ChartDataset<'line', ArticlePoint[]>[] = articleSeries.map(({ coin, articles }) => ({
      type: 'line',
      label: t('timeline.dataset.articles', { coin }),
      kind: 'articles' as DatasetKind,
      coin,
      data: articles,
      yAxisID: 'ySentiment',
      showLine: false,
      borderColor: ARTICLE_POINT_BORDER,
      backgroundColor: this.colorFor(coin),
      borderWidth: 1.5,
      // Point size encodes the article's relevance to the coin: 3px (marginal) to 6px (all about it).
      pointRadius: articles.map((a) => 3 + 3 * a.relevance),
      pointHoverRadius: articles.map((a) => 5 + 3 * a.relevance),
      pointHitRadius: ARTICLE_HIT_RADIUS,
      order: -1, // on top of the lines
    }));

    const candleDatasets = prices.map(({ coin, candles }) => {
      const color = this.colorFor(coin);
      const plotted = indexed ? indexCandles(candles) : candles;
      return {
        type: 'candlestick' as const,
        label: t('timeline.dataset.price', { coin }),
        kind: 'price' as DatasetKind,
        coin,
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
      data: {
        datasets: [
          ...sentimentDatasets,
          ...(articleDatasets as unknown as ChartDataset<'line'>[]),
          ...(candleDatasets as unknown as ChartDataset<'line'>[]),
        ],
      },
      plugins: [crosshairPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        animation: false,
        locale,
        interaction: { mode: 'nearestPerDataset', intersect: false },
        onHover: (event, elements, chart) => {
          chart.canvas.style.cursor = hoveredArticles(chart, elements).length ? 'pointer' : 'default';
        },
        onClick: (event, elements, chart) => this.openArticle(event, hoveredArticles(chart, elements)),
        scales: {
          x: {
            type: 'time',
            adapters: { date: { locale: locale.startsWith('pl') ? pl : enUS } },
            min: fromMs,
            max: toMs,
            offset: false,
            grid: { display: false },
            ticks: { maxRotation: 0, autoSkipPadding: 24 },
          },
          ySentiment: {
            type: 'linear',
            display: series.length > 0 || articleSeries.length > 0,
            position: 'left',
            min: -sentimentBound,
            max: sentimentBound,
            title: { display: true, text: t('timeline.axis.sentiment') },
            grid: {
              color: (ctx) => (ctx.tick.value === 0 ? ZERO_LINE_COLOR : GRIDLINE_COLOR),
              lineWidth: (ctx) => (ctx.tick.value === 0 ? 1.5 : 1),
            },
          },
          yPrice: {
            type: 'linear',
            position: 'right',
            display: prices.length > 0,
            title: {
              display: true,
              text: indexed ? t('timeline.axis.priceChange') : t('timeline.axis.price', { coin: prices[0]?.coin ?? '' }),
            },
            grid: { drawOnChartArea: false },
            ticks: {
              callback: (value) => (indexed ? `${formatSigned(+value)}%` : formatUsd(+value)),
            },
          },
        },
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true } },
          zoom: {
            limits: { x: { min: 'original', max: 'original', minRange: MIN_ZOOM_RANGE_MS } },
            pan: {
              enabled: true,
              mode: 'x',
              threshold: 5,
              onPanComplete: ({ chart }) => {
                this.lastPanEnd = Date.now();
                this.zoomed = chart.isZoomedOrPanned();
              },
            },
            zoom: {
              wheel: { enabled: true, speed: 0.1 },
              pinch: { enabled: true },
              mode: 'x',
              onZoomComplete: ({ chart }) => (this.zoomed = chart.isZoomedOrPanned()),
            },
          },
          tooltip: {
            // Hovered articles first: they're what the pointer is actually on.
            itemSort: (a, b) => +isArticleDataset(b.dataset) - +isArticleDataset(a.dataset),
            callbacks: {
              title: (items) => (items[0] ? new Date(items[0].parsed.x as number).toLocaleString(locale) : ''),
              label: (item) => this.tooltipLabel(item),
              footer: (items) => (items.some((i) => isArticleDataset(i.dataset)) ? t('timeline.tooltip.openHint') : ''),
            },
          },
        },
      },
    };
  }
}

/**
 * TradingView-style crosshair: dashed lines through the pointer with value labels on the time
 * axis and on each visible y-axis (formatted by that axis's own tick callback).
 */
const crosshairPlugin: Plugin = {
  id: 'crosshair',
  afterEvent(chart, args) {
    const state = chart as Chart & { $crosshair?: { x: number; y: number } | null };
    const { event } = args;
    if (event.type === 'mouseout' || !args.inChartArea) {
      if (state.$crosshair) {
        state.$crosshair = null;
        args.changed = true;
      }
    } else if (event.type === 'mousemove' && event.x !== null && event.y !== null) {
      state.$crosshair = { x: event.x, y: event.y };
      args.changed = true;
    }
  },
  afterDatasetsDraw(chart) {
    const pos = (chart as Chart & { $crosshair?: { x: number; y: number } | null }).$crosshair;
    if (!pos) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.strokeStyle = CROSSHAIR_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pos.x, chartArea.top);
    ctx.lineTo(pos.x, chartArea.bottom);
    ctx.moveTo(chartArea.left, pos.y);
    ctx.lineTo(chartArea.right, pos.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const x = chart.scales['x'];
    drawAxisLabel(ctx, formatCrosshairTime(x.getValueForPixel(pos.x) ?? 0, chart.options.locale), pos.x, x.top, 'top');
    for (const id of ['ySentiment', 'yPrice']) {
      const scale = chart.scales[id];
      if (!scale || !scale.options.display) continue;
      const value = scale.getValueForPixel(pos.y) ?? 0;
      const callback = (scale.options as unknown as { ticks: { callback: (v: number, i: number, t: unknown[]) => unknown } }).ticks.callback;
      const text = id === 'ySentiment' ? formatSigned(value, 2) : String(callback.call(scale, value, 0, []));
      drawAxisLabel(ctx, text, id === 'ySentiment' ? scale.right : scale.left, pos.y, id === 'ySentiment' ? 'left' : 'right');
    }
    ctx.restore();
  },
};

/** A filled label box on an axis edge: 'top' hangs below `y` centered on `x`; 'left'/'right' sit beside the axis line. */
function drawAxisLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, side: 'top' | 'left' | 'right'): void {
  ctx.font = '11px system-ui, sans-serif';
  const width = ctx.measureText(text).width + 10;
  const height = 18;
  const left = side === 'top' ? x - width / 2 : side === 'left' ? x - width : x;
  const top = side === 'top' ? y : y - height / 2;
  ctx.fillStyle = CROSSHAIR_LABEL_BG;
  ctx.fillRect(left, top, width, height);
  ctx.fillStyle = CROSSHAIR_LABEL_TEXT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + width / 2, top + height / 2);
}

function formatCrosshairTime(ms: number, locale?: string): string {
  return new Date(ms).toLocaleString(locale, { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function isArticleDataset(dataset: object): boolean {
  return (dataset as { kind?: DatasetKind }).kind === 'articles';
}

function hoveredArticles(chart: Chart, elements: { datasetIndex: number; index: number }[]): ArticlePoint[] {
  return elements
    .filter((e) => isArticleDataset(chart.data.datasets[e.datasetIndex]))
    .map((e) => chart.data.datasets[e.datasetIndex].data[e.index] as unknown as ArticlePoint);
}

/** One point per in-range article, placed on the index line at the article's publish time. */
function articlePoints(
  observations: SentimentObservation[],
  points: SentimentIndexPoint[],
  fromMs: number,
  toMs: number
): ArticlePoint[] {
  const valueAt = new Map(points.map((p) => [p.time, p.value]));
  return observations
    .filter((o) => o.articleId && o.time >= fromMs && o.time <= toMs)
    .map((o) => ({
      x: o.time,
      y: valueAt.get(o.time) ?? 0,
      articleId: o.articleId!,
      title: o.title,
      impact: o.value,
      relevance: o.weight,
    }));
}

const MAX_TITLE_LENGTH = 90;

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
