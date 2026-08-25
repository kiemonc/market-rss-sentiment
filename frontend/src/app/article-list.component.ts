import { DatePipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Article } from './article.model';

@Component({
  selector: 'app-article-list',
  imports: [DatePipe],
  templateUrl: './article-list.component.html',
  styleUrl: './article-list.component.css',
})
export class ArticleListComponent {
  @Input() articles: Article[] = [];
  @Input() selectedId: string | null = null;
  @Output() select = new EventEmitter<Article>();
}
