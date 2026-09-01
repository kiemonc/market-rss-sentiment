import { Article } from './article.model';

export type StatsDateField = 'publishedAt' | 'fetchedAt';

/**
 * Categorical palette, fixed order (dataviz skill default) — validated colorblind-safe as an
 * adjacent sequence. A source's color comes from its position in the full, alphabetically sorted
 * list of known sources (see colorForSource), not from the current filter selection, so a
 * source's color never changes when the selection changes.
 */
export const SOURCE_COLORS = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
];

export function colorForSource(source: string, allSourcesSorted: string[]): string {
  const index = allSourcesSorted.indexOf(source);
  return SOURCE_COLORS[index % SOURCE_COLORS.length];
}

export interface DailySeries {
  /** 'YYYY-MM-DD' (UTC), ascending, one entry per day in [from, to] with no gaps. */
  labels: string[];
  datasets: { source: string; counts: number[] }[];
}

/**
 * Buckets `articles` into per-day, per-source counts over every UTC day from `from` to `to`
 * (inclusive, 'YYYY-MM-DD'), filling days with no matching articles as 0 so lines stay continuous.
 * `sources` fixes which datasets exist (and their order) regardless of what's actually present in
 * `articles`, so a selected source with zero articles in range still renders as a flat zero line.
 */
export function bucketDailyCounts(
  articles: Article[],
  dateField: StatsDateField,
  sources: string[],
  from: string,
  to: string
): DailySeries {
  const labels = enumerateDays(from, to);
  const dayIndex = new Map(labels.map((day, i) => [day, i]));
  const datasets = sources.map((source) => ({ source, counts: new Array(labels.length).fill(0) }));
  const datasetBySource = new Map(datasets.map((d) => [d.source, d]));

  for (const article of articles) {
    const value = article[dateField];
    if (!value) continue;
    const index = dayIndex.get(value.slice(0, 10));
    const dataset = datasetBySource.get(article.source);
    if (index === undefined || !dataset) continue;
    dataset.counts[index]++;
  }

  return { labels, datasets };
}

function enumerateDays(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
