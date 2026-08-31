import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import {
  collection,
  doc,
  getCountFromServer,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  type OrderByDirection,
  query,
  type Query,
  type QueryDocumentSnapshot,
  startAfter,
  where,
  limit as fsLimit,
} from 'firebase/firestore';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';
import { Article } from './article.model';

export interface ArticlesPage {
  articles: Article[];
  /** Cursor to pass as `after` to fetch the page following this one, or null if this page was empty. */
  cursor: QueryDocumentSnapshot | null;
}

export interface ArticleFilters {
  source: string | null;
  /** Inclusive `publishedAt` bounds (ISO strings), from the "published from/to" filters. */
  publishedFrom: string | null;
  publishedTo: string | null;
}

export const EMPTY_FILTERS: ArticleFilters = { source: null, publishedFrom: null, publishedTo: null };

/** Cap on how many documents a title search reads, since it can't be server-paginated (see getArticlesForTitleSearch). */
export const TITLE_SEARCH_LIMIT = 1000;

@Injectable({ providedIn: 'root' })
export class ArticleService {
  private readonly firestore = getFirestore(initializeApp(environment.firebase));
  private readonly articlesCollection = collection(this.firestore, environment.articlesCollection);

  /**
   * Firestore requires a range filter's field to be the query's primary sort field, so a
   * date-range filter (on `publishedAt`) forces sorting by `publishedAt` regardless of `sortField`.
   */
  private buildFilteredQuery(
    sortField: keyof Article,
    direction: OrderByDirection,
    filters: ArticleFilters
  ): Query {
    const hasDateFilter = filters.publishedFrom != null || filters.publishedTo != null;
    const clauses = [];
    if (filters.source) clauses.push(where('source', '==', filters.source));
    if (filters.publishedFrom) clauses.push(where('publishedAt', '>=', filters.publishedFrom));
    if (filters.publishedTo) clauses.push(where('publishedAt', '<=', filters.publishedTo));

    const effectiveSortField = hasDateFilter ? 'publishedAt' : sortField;
    return query(this.articlesCollection, ...clauses, orderBy(effectiveSortField, direction));
  }

  /** Total number of articles matching `filters`, so the paginator can show/compute the real page count. */
  async countArticles(filters: ArticleFilters = EMPTY_FILTERS): Promise<number> {
    const snapshot = await getCountFromServer(this.buildFilteredQuery('fetchedAt', 'desc', filters));
    return snapshot.data().count;
  }

  /**
   * One page of articles matching `filters`, ordered by `sortField`. Pass the `cursor` from the
   * previous page to fetch the page after it, or null to fetch the first page.
   */
  async getArticlesPage(
    sortField: keyof Article,
    direction: OrderByDirection,
    pageSize: number,
    after: QueryDocumentSnapshot | null,
    filters: ArticleFilters = EMPTY_FILTERS
  ): Promise<ArticlesPage> {
    const base = this.buildFilteredQuery(sortField, direction, filters);
    const articlesQuery = after ? query(base, startAfter(after), fsLimit(pageSize)) : query(base, fsLimit(pageSize));

    const snapshot = await getDocs(articlesQuery);
    return {
      articles: snapshot.docs.map((doc) => doc.data() as Article),
      cursor: snapshot.docs.at(-1) ?? null,
    };
  }

  /**
   * Up to `TITLE_SEARCH_LIMIT` articles matching `filters`, for client-side title filtering.
   * Firestore can't do substring/contains queries, and a `source`/date filter already occupies
   * the query's one allowed range/equality field pairing, so title search reads a capped batch
   * and filters it in memory instead of being server-paginated like `getArticlesPage`.
   */
  async getArticlesForTitleSearch(
    sortField: keyof Article,
    direction: OrderByDirection,
    filters: ArticleFilters
  ): Promise<Article[]> {
    const articlesQuery = query(this.buildFilteredQuery(sortField, direction, filters), fsLimit(TITLE_SEARCH_LIMIT));
    const snapshot = await getDocs(articlesQuery);
    return snapshot.docs.map((doc) => doc.data() as Article);
  }

  /**
   * Distinct `source` values across all articles, for the source filter dropdown. Uses the
   * standard Firestore "distinct field" trick — one `limit(1)` query per distinct value found,
   * walking forward with a `>` filter — so cost is proportional to the number of sources, not
   * the number of articles.
   */
  async getDistinctSources(): Promise<string[]> {
    const sources: string[] = [];
    let last: string | null = null;
    for (;;) {
      const sourceQuery: Query = last
        ? query(this.articlesCollection, where('source', '>', last), orderBy('source'), fsLimit(1))
        : query(this.articlesCollection, orderBy('source'), fsLimit(1));
      const snapshot = await getDocs(sourceQuery);
      if (snapshot.empty) break;
      last = (snapshot.docs[0].data() as Article).source;
      sources.push(last);
    }
    return sources;
  }

  /** Live view of a single article by id, or null if it doesn't exist. */
  watchArticle(id: string): Observable<Article | null> {
    return new Observable<Article | null>((subscriber) => {
      return onSnapshot(
        doc(this.firestore, environment.articlesCollection, id),
        (snapshot) => subscriber.next(snapshot.exists() ? (snapshot.data() as Article) : null),
        (error) => subscriber.error(error)
      );
    });
  }
}
