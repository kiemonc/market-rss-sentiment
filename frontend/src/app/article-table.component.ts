import { AfterViewInit, Component, ViewChild, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { Router } from '@angular/router';
import type { OrderByDirection, QueryDocumentSnapshot } from 'firebase/firestore';
import { debounceTime, distinctUntilChanged, merge } from 'rxjs';
import { Article } from './article.model';
import { ArticleFilters, ArticleService, TITLE_SEARCH_LIMIT } from './article.service';
import { I18nService, TranslatePipe } from './i18n/i18n.service';

const DEFAULT_SORT_FIELD: keyof Article = 'fetchedAt';
const DEFAULT_SORT_DIRECTION: OrderByDirection = 'desc';

/**
 * The "Publication date" column sorts/filters by `publishedAt` (pubDate normalized to ISO at
 * scrape time — see src/scraper.ts), not the raw `pubDate` string, which varies in format by
 * source and doesn't sort correctly as a Firestore field. The "Fetched" column uses `fetchedAt`
 * (ingestion time) the same way, for the same reason.
 */
const SORT_FIELDS: Record<string, keyof Article> = {
  title: 'title',
  source: 'source',
  publicationDate: 'publishedAt',
  pubDate: 'fetchedAt',
};

@Component({
  selector: 'app-article-table',
  imports: [
    DatePipe,
    TranslatePipe,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './article-table.component.html',
  styleUrl: './article-table.component.css',
})
export class ArticleTableComponent implements AfterViewInit {
  private readonly articleService = inject(ArticleService);
  readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly displayedColumns = ['title', 'source', 'publicationDate', 'pubDate'];
  readonly dataSource = new MatTableDataSource<Article>([]);
  readonly filterForm = this.fb.group({
    source: this.fb.control<string | null>(null),
    title: this.fb.control(''),
    publishedFrom: this.fb.control(''),
    publishedTo: this.fb.control(''),
  });

  readonly titleSearchLimit = TITLE_SEARCH_LIMIT;

  loading = true;
  sources: string[] = [];
  /** Whether the title search hit TITLE_SEARCH_LIMIT and may be missing matches. */
  titleSearchCapped = false;

  // cursors[i] is the Firestore cursor for fetching page i; cursors[0] is always null (start of query).
  // Only cursors for pages already visited (in order) are known — see resolveCursor().
  private cursors: (QueryDocumentSnapshot | null)[] = [null];
  private lastSortKey = '';
  private lastPageSize = 0;
  private lastFilterKey = '';
  private loadToken = 0;

  @ViewChild(MatSort) private sort!: MatSort;
  @ViewChild(MatPaginator) private paginator!: MatPaginator;

  ngAfterViewInit(): void {
    this.lastPageSize = this.paginator.pageSize;
    this.lastFilterKey = JSON.stringify(this.filterForm.value);

    this.articleService.getDistinctSources().then((sources) => (this.sources = sources));

    const filterChanges = this.filterForm.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
    );

    merge(this.sort.sortChange, this.paginator.page, filterChanges).subscribe(() => {
      const sortKey = `${this.sort.active}:${this.sort.direction}`;
      const filterKey = JSON.stringify(this.filterForm.value);
      if (sortKey !== this.lastSortKey || this.paginator.pageSize !== this.lastPageSize || filterKey !== this.lastFilterKey) {
        this.lastSortKey = sortKey;
        this.lastPageSize = this.paginator.pageSize;
        this.lastFilterKey = filterKey;
        this.cursors = [null];
        this.paginator.pageIndex = 0;
        this.refreshCount();
      }
      this.loadPage(this.paginator.pageIndex);
    });

    this.refreshCount();
    this.loadPage(0);
  }

  private refreshCount(): void {
    if (this.titleQuery()) return; // title search sets paginator.length itself, from the filtered results
    this.articleService.countArticles(this.currentFilters()).then((count) => (this.paginator.length = count));
  }

  private titleQuery(): string {
    return (this.filterForm.value.title ?? '').trim().toLowerCase();
  }

  private currentFilters(): ArticleFilters {
    const { source, publishedFrom, publishedTo } = this.filterForm.value;
    return {
      source: source || null,
      publishedFrom: publishedFrom ? `${publishedFrom}T00:00:00.000Z` : null,
      publishedTo: publishedTo ? `${publishedTo}T23:59:59.999Z` : null,
    };
  }

  private async loadPage(pageIndex: number): Promise<void> {
    const token = ++this.loadToken;
    this.loading = true;
    const pageSize = this.paginator.pageSize;
    const sortField = SORT_FIELDS[this.sort.active] ?? DEFAULT_SORT_FIELD;
    const direction: OrderByDirection = (this.sort.direction || DEFAULT_SORT_DIRECTION) as OrderByDirection;
    const filters = this.currentFilters();
    const titleQuery = this.titleQuery();

    if (titleQuery) {
      // Firestore can't do a "contains" query, so this reads a capped batch and filters it
      // client-side — see ArticleService.getArticlesForTitleSearch.
      const articles = await this.articleService.getArticlesForTitleSearch(sortField, direction, filters);
      if (token !== this.loadToken) return;
      const matches = articles.filter((article) => article.title.toLowerCase().includes(titleQuery));
      this.titleSearchCapped = articles.length === TITLE_SEARCH_LIMIT;
      this.paginator.length = matches.length;
      this.dataSource.data = matches.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize);
      this.loading = false;
      return;
    }
    this.titleSearchCapped = false;

    const cursor = await this.resolveCursor(pageIndex, sortField, direction, pageSize, filters);
    if (token !== this.loadToken) return; // superseded by a newer page/sort/filter change

    const page = await this.articleService.getArticlesPage(sortField, direction, pageSize, cursor, filters);
    if (token !== this.loadToken) return;

    this.cursors[pageIndex + 1] = page.cursor;
    this.dataSource.data = page.articles;
    this.loading = false;
  }

  /**
   * Firestore pagination only offers cursors forward from a known page, so jumping
   * straight to an unvisited page (e.g. the paginator's "last page" button) walks
   * forward from the closest known cursor, discarding the intermediate pages' data.
   */
  private async resolveCursor(
    pageIndex: number,
    sortField: keyof Article,
    direction: OrderByDirection,
    pageSize: number,
    filters: ArticleFilters
  ): Promise<QueryDocumentSnapshot | null> {
    while (this.cursors[pageIndex] === undefined) {
      const knownIndex = this.cursors.length - 1;
      const page = await this.articleService.getArticlesPage(
        sortField,
        direction,
        pageSize,
        this.cursors[knownIndex],
        filters
      );
      this.cursors[knownIndex + 1] = page.cursor;
    }
    return this.cursors[pageIndex];
  }

  openArticle(article: Article): void {
    this.router.navigate(['/articles', article.id]);
  }
}
