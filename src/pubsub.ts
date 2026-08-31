interface Article {
  id: string;
  title: string;
  link: string;
  description: string;
  source: string;
  pubDate: string;
  /** `pubDate` normalized to ISO 8601, since RSS `pubDate` formats vary by source and don't sort/filter correctly as-is. */
  publishedAt: string;
}

interface ArticleWithContent extends Article {
  content: string;
  contentFetchedAt?: string;
}

interface ArticlePayload extends ArticleWithContent {
  fetchedAt: string;
}

export type { Article, ArticleWithContent, ArticlePayload };
