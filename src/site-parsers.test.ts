import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { extractWithSiteParser } from './site-parsers';

describe('extractWithSiteParser', () => {
  it('returns null for a source with no dedicated parser', () => {
    const $ = cheerio.load('<html><body><article>hello</article></body></html>');
    expect(extractWithSiteParser($, 'bloomberg')).toBeNull();
  });

  it('returns null when the dedicated container selector is not found on the page', () => {
    const $ = cheerio.load('<html><body><div class="something-else">hello</div></body></html>');
    expect(extractWithSiteParser($, 'cointelegraph')).toBeNull();
  });

  it('extracts cointelegraph article text from .ct-prose, ignoring byline/related-article siblings', () => {
    const html = `
      <html><body>
        <div data-testid="post">
          <p>Byline noise outside the prose block</p>
          <div class="ct-prose mt-4 pb-10">
            <p>First paragraph of the article.</p>
            <p>Second paragraph of the article.</p>
          </div>
        </div>
      </body></html>`;
    const $ = cheerio.load(html);
    expect(extractWithSiteParser($, 'cointelegraph')).toBe(
      'First paragraph of the article. Second paragraph of the article.'
    );
  });

  it('extracts decrypt article text from direct <p> children of .post-content, excluding nested widgets', () => {
    const html = `
      <html><body>
        <div class="grid post-content md:pb-20">
          <p>First paragraph.</p>
          <div class="my-4 border-b">
            <p>Daily Debrief Newsletter signup noise</p>
          </div>
          <p>Second paragraph.</p>
        </div>
      </body></html>`;
    const $ = cheerio.load(html);
    expect(extractWithSiteParser($, 'decrypt')).toBe('First paragraph. Second paragraph.');
  });

  it('extracts bitcoinmagazine article text from nested <p> inside .td-post-content', () => {
    const html = `
      <html><body>
        <div class="td_block_wrap tdb_single_content td-post-content">
          <div class="tdb-block-inner">
            <p>First paragraph.</p>
            <p>Second paragraph.</p>
          </div>
        </div>
      </body></html>`;
    const $ = cheerio.load(html);
    expect(extractWithSiteParser($, 'bitcoinmagazine')).toBe('First paragraph. Second paragraph.');
  });

  it('extracts cryptoslate article text from direct <p> children, excluding a nested newsletter widget', () => {
    const html = `
      <html><body>
        <div class="post-box__content-flow">
          <p>First paragraph.</p>
          <div class="cs-inline-newsletter">
            <p>Subscribe to our newsletter noise</p>
          </div>
          <p>Second paragraph.</p>
        </div>
      </body></html>`;
    const $ = cheerio.load(html);
    expect(extractWithSiteParser($, 'cryptoslate')).toBe('First paragraph. Second paragraph.');
  });

  it('extracts newsbtc article text from .content-inner and strips .trust / .cryptomediaos-attribution widgets', () => {
    const html = `
      <html><body>
        <div class="content-inner">
          <div class="trust">
            <div class="trust__accordion-item-content"><p>Lorem ipsum editorial policy noise</p></div>
          </div>
          <div>
            <p>First paragraph.</p>
            <p>Second paragraph.</p>
          </div>
          <div class="cryptomediaos-attribution"><p>This article is based on noise</p></div>
        </div>
      </body></html>`;
    const $ = cheerio.load(html);
    expect(extractWithSiteParser($, 'newsbtc')).toBe('First paragraph. Second paragraph.');
  });
});
