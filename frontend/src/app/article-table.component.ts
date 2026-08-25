import { AfterViewInit, Component, ViewChild, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { Router } from '@angular/router';
import { Article } from './article.model';
import { ArticleService } from './article.service';

@Component({
  selector: 'app-article-table',
  imports: [DatePipe, MatTableModule, MatSortModule, MatPaginatorModule],
  templateUrl: './article-table.component.html',
  styleUrl: './article-table.component.css',
})
export class ArticleTableComponent implements AfterViewInit {
  private readonly articleService = inject(ArticleService);
  private readonly router = inject(Router);

  readonly displayedColumns = ['title', 'source', 'pubDate'];
  readonly dataSource = new MatTableDataSource<Article>([]);

  private readonly articles = toSignal(this.articleService.watchArticles(), { initialValue: [] });

  @ViewChild(MatSort) private sort!: MatSort;
  @ViewChild(MatPaginator) private paginator!: MatPaginator;

  constructor() {
    effect(() => {
      this.dataSource.data = this.articles();
    });
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
  }

  openArticle(article: Article): void {
    this.router.navigate(['/articles', article.id]);
  }
}
