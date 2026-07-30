require('dotenv').config();
const path = require('path');

const config = {
  port: parseInt(process.env.PORT, 10) || 8080,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  gcp: {
    projectId: process.env.GCP_PROJECT_ID || 'test-project',
    pubsubTopic: process.env.PUBSUB_TOPIC || 'market-articles',
  },

  rssFeeds: (() => {
    const feedsJson = process.env.RSS_FEEDS || '[]';
    try {
      return JSON.parse(feedsJson);
    } catch (e) {
      console.warn('Invalid RSS_FEEDS JSON, using empty array', e.message);
      return [];
    }
  })(),

  pubsubEmulatorHost: process.env.PUBSUB_EMULATOR_HOST || null,
};

module.exports = config;
