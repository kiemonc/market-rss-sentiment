import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, Input, inject } from '@angular/core';
import { CoinSentiment, SentimentAnalysis } from './article.model';
import { diffBarFill, sentimentDirection, sortedCoinEntries, toPercent } from './article-sentiment.util';
import { I18nService, TranslatePipe } from './i18n/i18n.service';

@Component({
  selector: 'app-article-sentiment',
  imports: [DatePipe, DecimalPipe, TranslatePipe],
  templateUrl: './article-sentiment.component.html',
  styleUrl: './article-sentiment.component.css',
})
export class ArticleSentimentComponent {
  @Input() sentiment: SentimentAnalysis | null = null;
  readonly i18n = inject(I18nService);

  readonly toPercent = toPercent;
  readonly sentimentDirection = sentimentDirection;
  readonly diffBarFill = diffBarFill;

  get coinEntries(): [string, CoinSentiment][] {
    return this.sentiment ? sortedCoinEntries(this.sentiment.coins) : [];
  }
}
