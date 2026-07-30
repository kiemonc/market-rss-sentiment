const { PubSub } = require('@google-cloud/pubsub');
const config = require('./config');

let pubsubClient;
let topic;

async function initPubSub() {
  const pubsubConfig = {
    projectId: config.gcp.projectId,
  };

  if (config.pubsubEmulatorHost) {
    console.log(`Using Pub/Sub emulator at ${config.pubsubEmulatorHost}`);
  }

  pubsubClient = new PubSub(pubsubConfig);
  topic = pubsubClient.topic(config.gcp.pubsubTopic);

  try {
    const [topicExists] = await topic.exists();
    if (!topicExists) {
      console.log(`Topic ${config.gcp.pubsubTopic} does not exist. In production, ensure it's created in GCP.`);
      if (config.nodeEnv === 'development') {
        console.log('Running in development mode — will mock Pub/Sub publishing.');
      }
    }
  } catch (err) {
    console.warn('Could not verify topic existence:', err.message);
  }
}

async function publishArticle(article) {
  if (!topic) {
    console.error('Pub/Sub not initialized. Call initPubSub() first.');
    return null;
  }

  const payload = {
    id: article.id,
    title: article.title,
    link: article.link,
    description: article.description,
    source: article.source,
    pubDate: article.pubDate,
    fetchedAt: new Date().toISOString(),
  };

  try {
    const messageId = await topic.publish(Buffer.from(JSON.stringify(payload)));
    console.log(`Published article "${article.title}" to Pub/Sub (messageId: ${messageId})`);
    return messageId;
  } catch (err) {
    console.error('Failed to publish article:', err.message);
    return null;
  }
}

module.exports = {
  initPubSub,
  publishArticle,
};
