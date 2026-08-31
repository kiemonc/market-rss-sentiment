import type { CheerioAPI } from 'cheerio';

// Per-source article body extraction. Generic multi-selector scraping (the old
// approach in content-resolver.ts) picks up nav/related-article/newsletter
// boilerplate on most sites because it just grabs the first "big enough"
// container. These selectors were found by inspecting a real article page from
// each configured RSS_FEEDS source (see docs/architektura.md) and target the
// theme/framework-specific element that actually wraps just the article body.
interface SiteParser {
  container: string;
  // Extra selectors to strip out of the container before extracting text
  // (embedded widgets that live inside the article body markup itself).
  remove?: string[];
}

const SITE_PARSERS: Record<string, SiteParser> = {
  cointelegraph: { container: '.ct-prose' },
  decrypt: { container: '.post-content' },
  bitcoinmagazine: { container: '.td-post-content' },
  cryptoslate: { container: '.post-box__content-flow' },
  newsbtc: { container: '.content-inner', remove: ['.trust', '.cryptomediaos-attribution'] },
};

function extractContainerText($: CheerioAPI, container: ReturnType<CheerioAPI>): string {
  // Prefer direct <p> children: on themes that nest embedded widgets (newsletter
  // signups, related-article cards) one level deeper than the body paragraphs,
  // this excludes them without needing a per-widget removal selector.
  let paragraphs = container.children('p');
  if (paragraphs.length === 0) {
    paragraphs = container.find('p');
  }

  const text = paragraphs.length > 0 ? paragraphs.map((_, el) => $(el).text()).get().join(' ') : container.text();

  return text.replace(/\s+/g, ' ').trim();
}

// Returns extracted article text using the source's dedicated parser, or null
// if there's no dedicated parser for this source, or its selector didn't match
// the page (site markup changed) - callers should fall back to generic scraping.
function extractWithSiteParser($: CheerioAPI, source: string): string | null {
  const parser = SITE_PARSERS[source];
  if (!parser) return null;

  const container = $(parser.container).first();
  if (container.length === 0) return null;

  if (parser.remove) {
    container.find(parser.remove.join(', ')).remove();
  }

  const text = extractContainerText($, container);
  return text.length > 0 ? text : null;
}

export { extractWithSiteParser };
