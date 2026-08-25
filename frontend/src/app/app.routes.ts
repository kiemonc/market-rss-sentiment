import { Routes } from '@angular/router';
import { ArticleDetailComponent } from './article-detail.component';
import { ArticleTableComponent } from './article-table.component';

export const routes: Routes = [
  { path: '', component: ArticleTableComponent },
  { path: 'articles/:id', component: ArticleDetailComponent },
];
