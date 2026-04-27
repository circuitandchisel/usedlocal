import type { Listing, ListingSource, SearchOptions } from '../types.js';
import { USER_AGENT, MAX_RESULTS_PER_SOURCE } from '../globals.js';
import { resolveLocation } from '../locations.js';

/**
 * Craigslist deprecated their `?format=rss` Atom feed in 2024 (returns 403).
 * The standard HTML search URL still serves a JS-rendered app *plus* a static
 * SSR fallback inside `<li class="cl-static-search-result">` blocks for
 * crawlers — that's what we scrape. The static block contains title, price,
 * location, and the canonical listing URL; image and posted-date are not
 * available without a per-listing fetch.
 *
 * Example URL:
 *   https://sfbay.craigslist.org/search/sss?query=ikea+desk
 */
export const craigslistSource: ListingSource = {
  name: 'craigslist',
  async search(options: SearchOptions): Promise<Listing[]> {
    const resolved = resolveLocation(options.location);
    if (!resolved.craigslistSubdomain) {
      throw new Error(
        `Craigslist: no subdomain known for "${options.location}". ` +
        `Pass a Craigslist subdomain (e.g. "sfbay", "newyork") or a major city we recognise.`
      );
    }

    const params = new URLSearchParams();
    params.set('query', options.keywords);
    if (options.minPrice != null) params.set('min_price', String(options.minPrice));
    if (options.maxPrice != null) params.set('max_price', String(options.maxPrice));

    const url = `https://${resolved.craigslistSubdomain}.craigslist.org/search/sss?${params}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
    });
    if (!res.ok) {
      throw new Error(`Craigslist returned ${res.status} ${res.statusText}`);
    }
    const html = await res.text();

    const cap = options.maxPerSource ?? MAX_RESULTS_PER_SOURCE;
    const currency = guessCurrencyForSubdomain(resolved.craigslistSubdomain);
    const listings: Listing[] = [];

    const liRe = /<li class="cl-static-search-result"[^>]*>([\s\S]*?)<\/li>/g;
    let m: RegExpExecArray | null;
    while ((m = liRe.exec(html)) && listings.length < cap) {
      const block = m[1];
      const link = matchOne(block, /<a[^>]+href="([^"]+)"/);
      const title = matchOne(block, /<div class="title">([\s\S]*?)<\/div>/)?.trim();
      if (!link || !title) continue;

      const priceText = matchOne(block, /<div class="price">\s*\$?([\d,]+(?:\.\d{2})?)/);
      const price = priceText ? parseFloat(priceText.replace(/,/g, '')) : null;
      const location = matchOne(block, /<div class="location">\s*([^<]+?)\s*<\/div>/);

      const idMatch = link.match(/\/(\d{8,})\.html?(?:[?#]|$)/);
      const sourceId = idMatch ? idMatch[1] : link;

      listings.push({
        source: 'craigslist',
        sourceId,
        title: decodeEntities(title),
        url: link,
        price: price != null && Number.isFinite(price) ? price : null,
        currency: price != null ? currency : null,
        location: location ? decodeEntities(location) : null,
        description: null,
        imageUrl: null,
        postedAt: null,
      });
    }
    return listings;
  },
};

function matchOne(s: string, re: RegExp): string | null {
  const m = s.match(re);
  return m ? m[1] : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function guessCurrencyForSubdomain(sub: string): string {
  const cad = ['toronto', 'vancouver', 'montreal', 'calgary', 'ottawa'];
  if (cad.includes(sub)) return 'CAD';
  if (sub === 'london' || sub === 'paris' || sub === 'berlin') return 'EUR';
  return 'USD';
}
