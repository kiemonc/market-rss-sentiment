import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { Chart, type ChartConfiguration, registerables } from 'chart.js';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { bucketDailyCounts, colorForSource, DailySeries } from './article-stats.util';
import { ArticleService } from './article.service';
import { TranslatePipe } from './i18n/i18n.service';

Chart.register(...registerables);

const DEFAULT_RANGE_DAYS = 30;
const GRIDLINE_COLOR = '#e1e0d9';

@Component({
  selector: 'app-article-stats',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    TranslatePipe,
  ],
  templateUrl: './article-stats.component.html',
  styleUrl: './article-stats.component.css',
})
export class ArticleStatsComponent implements AfterViewInit, OnDestroy {
  private readonly articleService = inject(ArticleService);
  private readonly fb = inject(FormBuilder);

  readonly filterForm = this.fb.group({
    sources: this.fb.control<string[]>([]),
    from: this.fb.control(isoDaysAgo(DEFAULT_RANGE_DAYS)),
    to: this.fb.control(isoDaysAgo(0)),
  });

  @ViewChild('publishedCanvas') private publishedCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('fetchedCanvas') private fetchedCanvasRef!: ElementRef<HTMLCanvasElement>;

  allSources: string[] = [];
  loading = true;

  private publishedChart?: Chart;
  private fetchedChart?: Chart;
  private loadToken = 0;

  async ngAfterViewInit(): Promise<void> {
    this.allSources = (await this.articleService.getDistinctSources()).sort();
    this.filterForm.patchValue({ sources: [...this.allSources] });

    this.filterForm.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
      )
      .subscribe(() => this.refresh());

    await this.refresh();
  }

  ngOnDestroy(): void {
    this.publishedChart?.destroy();
    this.fetchedChart?.destroy();
  }

  private async refresh(): Promise<void> {
    const { sources, from, to } = this.filterForm.value;
    if (!from || !to || !sources?.length) return;

    const token = ++this.loadToken;
    this.loading = true;

    const fromIso = `${from}T00:00:00.000Z`;
    const toIso = `${to}T23:59:59.999Z`;
    // Omitting the source filter entirely (rather than passing every known source as an `in`
    // list) avoids needing the source+date composite index for the common "all sources" case.
    const selectedSources = sources.length === this.allSources.length ? null : sources;

    const [publishedArticles, fetchedArticles] = await Promise.all([
      this.articleService.getArticlesForStats('publishedAt', { sources: selectedSources, from: fromIso, to: toIso }),
      this.articleService.getArticlesForStats('fetchedAt', { sources: selectedSources, from: fromIso, to: toIso }),
    ]);
    if (token !== this.loadToken) return; // superseded by a newer filter change

    this.publishedChart = this.renderChart(
      this.publishedCanvasRef,
      this.publishedChart,
      bucketDailyCounts(publishedArticles, 'publishedAt', sources, from, to)
    );
    this.fetchedChart = this.renderChart(
      this.fetchedCanvasRef,
      this.fetchedChart,
      bucketDailyCounts(fetchedArticles, 'fetchedAt', sources, from, to)
    );
    this.loading = false;
  }

  private renderChart(canvasRef: ElementRef<HTMLCanvasElement>, existing: Chart | undefined, series: DailySeries): Chart {
    existing?.destroy();
    return new Chart(canvasRef.nativeElement, this.buildConfig(series));
  }

  private buildConfig(series: DailySeries): ChartConfiguration<'line'> {
    return {
      type: 'line',
      data: {
        labels: series.labels,
        datasets: series.datasets.map((d) => {
          const color = colorForSource(d.source, this.allSources);
          return {
            label: d.source,
            data: d.counts,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.15,
          };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: GRIDLINE_COLOR } },
          x: { grid: { display: false } },
        },
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true } },
          tooltip: { mode: 'index', intersect: false },
        },
      },
    };
  }
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
