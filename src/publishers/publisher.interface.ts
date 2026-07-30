import { ArticleWithContent } from '../pubsub';

export interface Publisher {
  initialize(): Promise<void>;
  publish(article: ArticleWithContent): Promise<string | null>;
  close?(): Promise<void>;
}
