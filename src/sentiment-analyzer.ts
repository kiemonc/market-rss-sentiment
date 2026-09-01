import { GoogleGenAI, Type } from '@google/genai';
import { Config } from './config';
import { SentimentAnalysis } from './sentiment';

interface ArticleForAnalysis {
  title: string;
  content: string;
}

interface RawCoinSentiment {
  coin: string;
  vector: number[];
  weight: number;
  sentimentDiff: number;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    coins: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          coin: { type: Type.STRING, description: 'Uppercase ticker symbol, e.g. BTC, ETH, SOL.' },
          vector: {
            type: Type.ARRAY,
            items: { type: Type.NUMBER },
            minItems: 3,
            maxItems: 3,
            description: '[bullish, bearish, neutral] confidence scores, each in [0,1].',
          },
          weight: { type: Type.NUMBER, description: 'Relevance of this coin to the article, in [0,1].' },
          sentimentDiff: {
            type: Type.NUMBER,
            description:
              'Signed impact on investor sentiment for this coin: positive = bullish, negative = bearish, in [-1,1].',
          },
        },
        required: ['coin', 'vector', 'weight', 'sentimentDiff'],
      },
    },
  },
  required: ['coins'],
};

function buildPrompt(article: ArticleForAnalysis): string {
  return `You are a crypto-market sentiment analyst. Given the news article below, identify every \
cryptocurrency it discusses or that it materially affects, and assess the article's impact on \
investor sentiment for each one.

For each coin, use its uppercase ticker symbol (e.g. BTC, ETH, SOL) and provide:
- vector: [bullish, bearish, neutral] confidence scores in [0,1] that sum to roughly 1
- weight: how prominently/relevantly this coin features in the article, in [0,1]
- sentimentDiff: the signed impact on investor sentiment for this coin, in [-1,1] — positive means \
the article is bullish for the coin, negative means bearish

If the article mentions no cryptocurrencies, return an empty coins array.

Title: ${article.title}

Article:
${article.content}`;
}

let client: GoogleGenAI | undefined;
function getClient(cfg: Config): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ vertexai: true, project: cfg.gcp.projectId, location: cfg.vertexAi.location });
  }
  return client;
}

async function analyzeArticleSentiment(article: ArticleForAnalysis, cfg: Config): Promise<SentimentAnalysis> {
  const response = await getClient(cfg).models.generateContent({
    model: cfg.vertexAi.model,
    contents: buildPrompt(article),
    config: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Vertex AI returned an empty response');
  }

  let parsed: { coins: RawCoinSentiment[] };
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Vertex AI returned invalid JSON: ${(err as Error).message}`);
  }

  const result: SentimentAnalysis = {};
  for (const c of parsed.coins ?? []) {
    if (!c.coin || !Array.isArray(c.vector) || c.vector.length !== 3) {
      console.warn('Skipping malformed coin entry from Vertex AI response:', JSON.stringify(c));
      continue;
    }
    result[c.coin.toUpperCase()] = {
      vector: [c.vector[0], c.vector[1], c.vector[2]],
      weight: c.weight,
      sentimentDiff: c.sentimentDiff,
    };
  }
  return result;
}

export { analyzeArticleSentiment };
export type { ArticleForAnalysis };
