import 'dotenv/config';

interface RSSFeed {
  name: string;
  url: string;
}

interface Config {
  port: number;
  nodeEnv: string;
  publisherType: 'gcp' | 'file';
  gcp: {
    projectId: string;
    pubsubTopic: string;
  };
  filePublisher: {
    outputDir: string;
  };
  rssFeeds: RSSFeed[];
  pubsubEmulatorHost: string | null;
  vertexAi: {
    location: string;
    model: string;
  };
  articlesCollection: string;
  sentimentCollection: string;
}

const publisherType = (process.env.PUBLISHER_TYPE || (process.env.NODE_ENV === 'production' ? 'gcp' : 'file')) as 'gcp' | 'file';

const config: Config = {
  port: parseInt(process.env.PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  publisherType,

  gcp: {
    projectId: process.env.GCP_PROJECT_ID || 'test-project',
    pubsubTopic: process.env.PUBSUB_TOPIC || 'market-articles',
  },

  filePublisher: {
    outputDir: process.env.ARTICLES_OUTPUT_DIR || './articles',
  },

  rssFeeds: (() => {
    const feedsJson = process.env.RSS_FEEDS || '[]';
    try {
      return JSON.parse(feedsJson) as RSSFeed[];
    } catch (e) {
      console.warn('Invalid RSS_FEEDS JSON:', (e as Error).message);
      console.warn('Expected format: RSS_FEEDS=\'[{"name":"feed1","url":"https://..."}]\'');
      console.warn('Or as: RSS_FEEDS=[{"name":"feed1","url":"https://..."}]');
      return [];
    }
  })(),

  pubsubEmulatorHost: process.env.PUBSUB_EMULATOR_HOST || null,

  vertexAi: {
    location: process.env.VERTEX_AI_LOCATION || 'us-central1',
    model: process.env.VERTEX_AI_MODEL || 'gemini-2.5-flash-lite',
  },

  articlesCollection: process.env.FIRESTORE_COLLECTION || 'articles',
  sentimentCollection: process.env.SENTIMENT_COLLECTION || 'sentiment',
};

export default config;
export type { RSSFeed, Config };
