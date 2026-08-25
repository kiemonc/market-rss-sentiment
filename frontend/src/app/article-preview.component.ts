import { DatePipe } from '@angular/common';
import { Component, Input } from '@angular/core';
import { Article } from './article.model';

@Component({
  selector: 'app-article-preview',
  imports: [DatePipe],
  templateUrl: './article-preview.component.html',
  styleUrl: './article-preview.component.css',
})
export class ArticlePreviewComponent {
  @Input() article: Article | null = null;
}
