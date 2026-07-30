import 'dotenv/config';

interface RSSFeed {
  name: string;
  url: string;
}

interface Config {
  port: number;
  nodeEnv: string;
  gcp: {
    projectId: string;
    pubsubTopic: string;
  };
  rssFeeds: RSSFeed[];
  pubsubEmulatorHost: string | null;
}

const config: Config = {
  port: parseInt(process.env.PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  gcp: {
    projectId: process.env.GCP_PROJECT_ID || 'test-project',
    pubsubTopic: process.env.PUBSUB_TOPIC || 'market-articles',
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
};

export default config;
export type { RSSFeed, Config };
