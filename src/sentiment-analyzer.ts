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
  priceRecap?: boolean;
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
              'Signed forward-looking impact of new information on this coin: positive = bullish, negative = bearish, in [-1,1].',
          },
          priceRecap: {
            type: Type.BOOLEAN,
            description: "True if the article's take on this coin is mainly a report of its own past price/market moves.",
          },
        },
        required: ['coin', 'vector', 'weight', 'sentimentDiff', 'priceRecap'],
      },
    },
  },
  required: ['coins'],
};

// Prompt rules below come from comparing stored scores with Binance prices (2026-10): the old,
// unconstrained prompt mostly echoed the price move the article was reporting (correlated with
// the *previous* 24h return, not the next), and scored stocks, stablecoins and passing mentions
// with the article's overall mood — noise that drowned out the actual news signal.
function buildPrompt(article: ArticleForAnalysis): string {
  return `You are a crypto-market sentiment analyst. Given the news article below, identify the \
cryptocurrencies whose outlook the article's NEW information materially affects, and assess the \
forward-looking impact of that information on investor sentiment for each one.

Which coins to include:
- Only freely floating cryptoassets, by their uppercase ticker symbol (e.g. BTC, ETH, SOL).
- Do NOT include stocks or other equities (e.g. COIN, MSTR, HOOD), ETFs, indices or fiat currencies.
- Do NOT include stablecoins (USDT, USDC, ...) — their price is pegged, so sentiment doesn't apply.
- A coin mentioned only in passing, as context or in a list, without the news affecting it, gets \
a low weight and a sentimentDiff of 0 — or leave it out entirely.

For each coin provide:
- vector: [bullish, bearish, neutral] confidence scores in [0,1] that sum to roughly 1
- weight: how central this coin is to the article, in [0,1] (1 = the article is about it)
- sentimentDiff: the signed impact of the article's NEW information on the coin's outlook, in \
[-1,1] — positive means bullish, negative means bearish. Judge what this news changes going \
forward, not the article's tone: a price move that already happened is already priced in, so an \
article that merely reports or recaps a rally, a drop, liquidations or chart levels scores close \
to 0 unless it also brings new fundamental information (adoption, regulation, flows, hacks, \
macro, protocol changes, ...). Reserve values beyond ±0.6 for clearly market-moving news.
- priceRecap: true if the article's take on this coin is mainly a report of its own past price \
or market moves (price action, technical analysis, liquidations, trader positioning); false if it \
is driven by other news

If no cryptocurrency qualifies, return an empty coins array.

Title: ${article.title}

Article:
${article.content}`;
}

// The prompt already excludes these, but flash-lite doesn't always comply. Stablecoins are pegged
// (no price sentiment to track) and equities aren't crypto — both only add noise to coin indexes.
const EXCLUDED_TICKERS = new Set([
  'USDT', 'USDC', 'DAI', 'USDE', 'USDS', 'FDUSD', 'PYUSD', 'RLUSD', 'TUSD', 'USD1', 'EURC', 'USDG',
  'COIN', 'MSTR', 'STRC', 'HOOD', 'CRCL', 'GLXY', 'MARA', 'RIOT', 'BMNR', 'SBET', 'TSLA', 'NVDA',
]);

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
      // This is a single-shot structured extraction, not multi-step reasoning — dynamic
      // thinking would otherwise bill hidden reasoning tokens for no accuracy benefit here.
      thinkingConfig: { thinkingBudget: 0 },
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
    const ticker = c.coin.toUpperCase();
    if (EXCLUDED_TICKERS.has(ticker)) continue;
    result[ticker] = {
      vector: [c.vector[0], c.vector[1], c.vector[2]],
      weight: c.weight,
      sentimentDiff: c.sentimentDiff,
      ...(typeof c.priceRecap === 'boolean' && { priceRecap: c.priceRecap }),
    };
  }
  return result;
}

export { analyzeArticleSentiment };
export type { ArticleForAnalysis };
