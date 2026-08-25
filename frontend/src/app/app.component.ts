import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ArticleListComponent } from './article-list.component';
import { ArticlePreviewComponent } from './article-preview.component';
import { Article } from './article.model';
import { ArticleService } from './article.service';

@Component({
  selector: 'app-root',
  imports: [ArticleListComponent, ArticlePreviewComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  private readonly articleService = inject(ArticleService);

  readonly articles = toSignal(this.articleService.watchArticles(), { initialValue: [] });
  readonly selected = signal<Article | null>(null);

  select(article: Article): void {
    this.selected.set(article);
  }
}
