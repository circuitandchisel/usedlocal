import type { AmazonReference } from './types.js';
import { APIFY_TOKEN } from './globals.js';
import { titleTokens, jaccard } from './dedup.js';

/**
 * "Is this used listing priced sanely vs. the new-product market?" lookups,
 * powered by the Apify `junglee/amazon-crawler` actor. The actor takes a
 * full Amazon search URL (we build one from the cleaned listing title), and
 * returns up to N products from the search results page. We keep the
 * top-ranked product and attach a confidence score derived from
 * title-token Jaccard similarity to the original listing title.
 *
 * NB: Amazon search rankings are *not* exact-match. For a query like
 * "Vintage Marshall amp", the top hit will likely be a current Marshall
 * combo amp, not a true vintage match. The confidence score lets the agent
 * client decide whether to surface the comparison; a `low` score means the
 * Amazon result is probably a different product entirely.
 *
 * (We previously tried `damilo/amazon-search-scraper` — its actor exits
 * with "Something went wrong" and returns an empty dataset on most queries
 * yet reports SUCCEEDED, so don't trust that one.)
 */

const ACTOR_ID = 'junglee~amazon-crawler';
let loggedSampleItem = false;

export async function amazonLookup(listingTitle: string, timeoutMs = 180_000): Promise<AmazonReference | null> {
  if (!APIFY_TOKEN) {
    throw new Error('Amazon cross-reference requires APIFY_TOKEN');
  }

  const query = cleanQuery(listingTitle);
  if (!query) return null;

  const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
  const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&clean=true`;

  const body = {
    categoryOrProductUrls: [{ url: searchUrl }],
    maxItemsPerStartUrl: 3,
    maxSearchPagesPerStartUrl: 1,
    // Skip the per-product detail fetch — search-result-level data (title,
    // price, image, url) is enough for cross-reference and the per-product
    // pass roughly triples actor runtime + cost.
    scrapeProductDetails: false,
    useCaptchaSolver: true,
    proxyCountry: 'AUTO_SELECT_PROXY_COUNTRY',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Apify Amazon actor returned ${res.status} ${res.statusText}${errBody ? `: ${errBody.slice(0, 200)}` : ''}`);
  }

  const items: any[] = await res.json();
  if (!loggedSampleItem && items.length > 0) {
    loggedSampleItem = true;
    console.log('[amazon] sample item shape:', JSON.stringify(items[0]).slice(0, 1000));
  }
  if (items.length === 0) return null;

  const top = items[0];
  const result = mapItem(top);
  if (!result) return null;

  const sim = jaccard(titleTokens(listingTitle), titleTokens(result.title));
  const confidence: AmazonReference['confidence'] = sim >= 0.5 ? 'high' : sim >= 0.3 ? 'medium' : 'low';

  return {
    title: result.title,
    url: result.url,
    price: result.price,
    currency: result.currency,
    imageUrl: result.imageUrl,
    confidence,
    titleSimilarity: Math.round(sim * 100) / 100,
  };
}

function cleanQuery(title: string): string {
  // Strip emojis, parenthetical asides, and excess punctuation; cap at 120 chars.
  // Amazon's ranker doesn't like very long queries with sale-y noise.
  return title
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^A-Za-z0-9\s\-+/&'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function mapItem(raw: any): { title: string; url: string; price: number | null; currency: string | null; imageUrl: string | null } | null {
  const title = raw.title ?? raw.name ?? raw.productTitle;
  const asin = raw.asin ?? raw.ASIN;
  const rawUrl = raw.url ?? raw.productUrl ?? raw.link;
  if (!title) return null;

  let url: string;
  if (asin && typeof asin === 'string') {
    url = `https://www.amazon.com/dp/${asin}`;
  } else if (rawUrl) {
    url = String(rawUrl).startsWith('http') ? String(rawUrl) : `https://www.amazon.com${rawUrl}`;
  } else {
    return null;
  }

  // junglee/amazon-crawler shapes prices as { value, currency } in price
  // and/or as separate `price` (number) field, depending on what's on the
  // search results page. Defensive map.
  let price: number | null = null;
  let currency: string | null = null;
  if (typeof raw.price === 'number') {
    price = raw.price;
  } else if (typeof raw.price === 'string') {
    const m = raw.price.match(/[\d,]+(?:\.\d{2})?/);
    if (m) price = parseFloat(m[0].replace(/,/g, ''));
  } else if (raw.price && typeof raw.price === 'object') {
    const v = raw.price.value ?? raw.price.amount ?? raw.price.current_price;
    if (typeof v === 'number') price = v;
    else if (typeof v === 'string') price = parseFloat(v);
    currency = raw.price.currency ?? null;
  }
  if (typeof raw.priceValue === 'number') price = raw.priceValue;
  if (typeof raw.currentPrice === 'number') price = raw.currentPrice;
  if (price != null && !currency) currency = 'USD';

  const imageUrl =
    raw.image ??
    raw.imageUrl ??
    raw.thumbnail ??
    raw.thumbnailImage ??
    (Array.isArray(raw.images) ? (raw.images[0]?.url ?? raw.images[0] ?? null) : null);

  return {
    title: String(title).trim(),
    url,
    price: price != null && Number.isFinite(price) ? price : null,
    currency,
    imageUrl: typeof imageUrl === 'string' ? imageUrl : null,
  };
}
