import type { Listing, ListingSource, SearchOptions } from '../types.js';
import { APIFY_TOKEN, MAX_RESULTS_PER_SOURCE } from '../globals.js';

/**
 * eBay backend powered by the Apify `kawsar/ebay-search-listing-scraper`
 * actor. eBay listings aren't strictly "local" — the actor doesn't take a
 * city filter — so we use eBay as a *national* used-market signal that
 * complements the geo-pinned sources (Craigslist / Kijiji / Facebook). For
 * the user's stated goal ("are people asking too much vs. the used market?")
 * national eBay coverage is exactly what we want.
 *
 * Actor input schema (verified):
 *   searchKeyword: string
 *   condition:     'any' | 'new' | 'used' | 'not_specified'
 *   sortOrder:     'best_match' | 'lowest_price' | 'highest_price' | 'ending_soonest' | 'newly_listed'
 *   minPrice / maxPrice: number
 *   maxItems:      integer (1–1000, default 48)
 *
 * Output field names aren't documented; mapping is defensive (multiple
 * candidates per field) and we log the first item once at startup.
 */

const ACTOR_ID = 'kawsar~ebay-search-listing-scraper';
let loggedSampleItem = false;

export const ebayApifySource: ListingSource = {
  name: 'ebay',
  async search(options: SearchOptions): Promise<Listing[]> {
    if (!APIFY_TOKEN) {
      throw new Error('eBay backend requires APIFY_TOKEN');
    }

    const cap = Math.min(options.maxPerSource ?? MAX_RESULTS_PER_SOURCE, 1000);
    const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&clean=true`;

    const body: Record<string, unknown> = {
      searchKeyword: options.keywords,
      condition: 'used',
      sortOrder: 'best_match',
      maxItems: cap,
    };
    if (options.minPrice != null) body.minPrice = options.minPrice;
    if (options.maxPrice != null) body.maxPrice = options.maxPrice;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Same reasoning as kijiji-apify: actor cold-start + scrape can take a minute or two.
      signal: AbortSignal.timeout(Math.max(options.timeoutMs ?? 0, 180_000)),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Apify eBay actor returned ${res.status} ${res.statusText}${errBody ? `: ${errBody.slice(0, 200)}` : ''}`);
    }

    const items: any[] = await res.json();
    if (!loggedSampleItem && items.length > 0) {
      loggedSampleItem = true;
      console.log('[ebay-apify] sample item shape:', JSON.stringify(items[0]).slice(0, 1000));
    }

    return items.slice(0, cap).map(toListing).filter((l): l is Listing => l !== null);
  },
};

function toListing(raw: any): Listing | null {
  if (!raw || typeof raw !== 'object') return null;

  const itemId =
    raw.itemId ?? raw.id ?? raw.listingId ?? raw.legacyItemId ?? raw.itemNumber;
  const title = raw.listingTitle ?? raw.title ?? raw.itemTitle ?? raw.name;
  const rawUrl = raw.listingUrl ?? raw.itemUrl ?? raw.url ?? raw.itemWebUrl ?? raw.link ?? raw.viewItemURL;
  if (itemId == null || !title || !rawUrl) return null;

  const url = String(rawUrl).startsWith('http') ? String(rawUrl) : `https://www.ebay.com${rawUrl}`;

  // Price can be: number, "$120.00", "US $120.00", or { value, currency }.
  let price: number | null = null;
  let currency: string | null = null;
  if (typeof raw.price === 'number') {
    price = raw.price;
  } else if (typeof raw.price === 'string') {
    const m = raw.price.match(/[\d,]+(?:\.\d{2})?/);
    if (m) price = parseFloat(m[0].replace(/,/g, ''));
    const cm = raw.price.match(/[A-Z]{3}/);
    if (cm) currency = cm[0];
  } else if (raw.price && typeof raw.price === 'object') {
    const v = raw.price.value ?? raw.price.amount;
    if (typeof v === 'number') price = v;
    else if (typeof v === 'string') price = parseFloat(v);
    currency = raw.price.currency ?? null;
  } else if (typeof raw.priceValue === 'number') {
    price = raw.priceValue;
    currency = raw.priceCurrency ?? null;
  }
  // The actor surfaces currency as its own top-level field too.
  if (!currency && typeof raw.currency === 'string') currency = raw.currency;

  const imageUrl =
    raw.image ??
    raw.imageUrl ??
    raw.galleryUrl ??
    (Array.isArray(raw.images) ? (raw.images[0]?.url ?? raw.images[0] ?? null) : null);

  const location = raw.itemLocation ?? raw.location?.country ?? raw.location ?? null;

  return {
    source: 'ebay',
    sourceId: String(itemId),
    // eBay's listing list crams a "New" badge into the title text as
    // "New Listing<title>"; strip it so dedup doesn't see false uniqueness.
    title: String(title).replace(/^New Listing/, '').trim(),
    url,
    price: price != null && Number.isFinite(price) ? price : null,
    currency: currency ?? (price != null ? 'USD' : null),
    location: typeof location === 'string' ? location : (location ? JSON.stringify(location).slice(0, 80) : null),
    description: null,
    imageUrl: typeof imageUrl === 'string' ? imageUrl : null,
    postedAt: raw.startTime ?? raw.listedAt ?? raw.activationDate ?? null,
  };
}
