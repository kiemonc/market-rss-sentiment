import { Routes } from '@angular/router';
import { ArticleDetailComponent } from './article-detail.component';
import { ArticleStatsComponent } from './article-stats.component';
import { ArticleTableComponent } from './article-table.component';
import { SentimentTimelineComponent } from './sentiment-timeline.component';

export const routes: Routes = [
  { path: '', component: ArticleTableComponent },
  { path: 'stats', component: ArticleStatsComponent },
  { path: 'sentiment', component: SentimentTimelineComponent },
  { path: 'articles/:id', component: ArticleDetailComponent },
];
