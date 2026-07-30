import { Article } from '../pubsub';

export interface Publisher {
  initialize(): Promise<void>;
  publish(article: Article): Promise<string | null>;
  close?(): Promise<void>;
}
