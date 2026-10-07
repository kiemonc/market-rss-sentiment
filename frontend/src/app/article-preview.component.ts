import { DatePipe } from '@angular/common';
import { Component, Input, inject } from '@angular/core';
import { Article } from './article.model';
import { I18nService, TranslatePipe } from './i18n/i18n.service';

@Component({
  selector: 'app-article-preview',
  imports: [DatePipe, TranslatePipe],
  templateUrl: './article-preview.component.html',
  styleUrl: './article-preview.component.css',
})
export class ArticlePreviewComponent {
  @Input() article: Article | null = null;
  readonly i18n = inject(I18nService);
}
