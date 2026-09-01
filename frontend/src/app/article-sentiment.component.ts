import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, Input } from '@angular/core';
import { CoinSentiment, SentimentAnalysis } from './article.model';
import { diffBarFill, sentimentDirection, sortedCoinEntries, toPercent } from './article-sentiment.util';

@Component({
  selector: 'app-article-sentiment',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './article-sentiment.component.html',
  styleUrl: './article-sentiment.component.css',
})
export class ArticleSentimentComponent {
  @Input() sentiment: SentimentAnalysis | null = null;

  readonly toPercent = toPercent;
  readonly sentimentDirection = sentimentDirection;
  readonly diffBarFill = diffBarFill;

  get coinEntries(): [string, CoinSentiment][] {
    return this.sentiment ? sortedCoinEntries(this.sentiment.coins) : [];
  }
}
