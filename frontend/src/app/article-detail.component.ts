import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map, switchMap } from 'rxjs';
import { ArticlePreviewComponent } from './article-preview.component';
import { ArticleService } from './article.service';

@Component({
  selector: 'app-article-detail',
  imports: [ArticlePreviewComponent, RouterLink],
  templateUrl: './article-detail.component.html',
  styleUrl: './article-detail.component.css',
})
export class ArticleDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly articleService = inject(ArticleService);

  readonly article = toSignal(
    this.route.paramMap.pipe(
      map((params) => params.get('id')!),
      switchMap((id) => this.articleService.watchArticle(id))
    ),
    { initialValue: null }
  );
}
