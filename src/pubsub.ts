interface Article {
  id: string;
  title: string;
  link: string;
  description: string;
  source: string;
  pubDate: string;
}

interface ArticlePayload extends Article {
  fetchedAt: string;
}

export type { Article, ArticlePayload };
