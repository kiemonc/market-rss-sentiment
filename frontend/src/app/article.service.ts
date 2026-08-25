import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import {
  collection,
  doc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';
import { Article } from './article.model';

const ARTICLE_LIMIT = 50;

@Injectable({ providedIn: 'root' })
export class ArticleService {
  private readonly firestore = getFirestore(initializeApp(environment.firebase));

  /** Live list of articles, newest scraped first. */
  watchArticles(): Observable<Article[]> {
    return new Observable<Article[]>((subscriber) => {
      const articlesQuery = query(
        collection(this.firestore, environment.articlesCollection),
        orderBy('fetchedAt', 'desc'),
        limit(ARTICLE_LIMIT)
      );

      return onSnapshot(
        articlesQuery,
        (snapshot) => subscriber.next(snapshot.docs.map((doc) => doc.data() as Article)),
        (error) => subscriber.error(error)
      );
    });
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
