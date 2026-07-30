interface Article {
  id: string;
  title: string;
  link: string;
  description: string;
  source: string;
  pubDate: string;
}

interface ArticleWithContent extends Article {
  content: string;
  contentFetchedAt?: string;
}

interface ArticlePayload extends ArticleWithContent {
  fetchedAt: string;
}

export type { Article, ArticleWithContent, ArticlePayload };
