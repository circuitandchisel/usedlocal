import type { Listing, ListingSource, SearchOptions } from '../types.js';
import { APIFY_TOKEN, MAX_RESULTS_PER_SOURCE } from '../globals.js';
import { resolveLocation } from '../locations.js';

/**
 * Facebook Marketplace via the (Apify-maintained) `apify/facebook-marketplace-scraper`
 * actor. This is a first-party actor — most reliable bet for FB given the
 * site's auth + anti-bot wall.
 *
 * Pricing: $2.60 / 1,000 listings. At our 50-listing cap that's ~$0.13/call.
 *
 * Actor input schema (verified):
 *   startUrls: string[]              required — Facebook Marketplace URLs
 *   resultsLimit: integer            optional, no default (so we MUST pass one or pay for unbounded scraping)
 *   includeListingDetails: boolean   optional, default false (per-listing fetch; off = list-page data only)
 *
 * The actor doesn't accept location/keyword/price as separate fields — they
 * have to be encoded into the search URL itself:
 *   https://www.facebook.com/marketplace/<city-slug>/search?query=<kw>&minPrice=...&maxPrice=...
 *
 * When `compareWithAmazon` is on, we don't need the per-listing detail fetch
 * (we already aren't displaying it elsewhere), so we leave includeListingDetails
 * off to keep the actor fast + cheap.
 */

const ACTOR_ID = 'apify~facebook-marketplace-scraper';
let loggedSampleItem = false;

export const facebookSource: ListingSource = {
  name: 'facebook',
  async search(options: SearchOptions): Promise<Listing[]> {
    if (!APIFY_TOKEN) {
      throw new Error(
        'Facebook Marketplace requires APIFY_TOKEN (the Apify FB actor handles auth + anti-bot externally). ' +
        'Set APIFY_TOKEN and add `facebook` to ENABLED_SOURCES.'
      );
    }

    const startUrl = buildSearchUrl(options);
    const cap = options.maxPerSource ?? MAX_RESULTS_PER_SOURCE;
    const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&clean=true`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // The Apify-maintained FB actor wants Crawlee request objects, not
        // plain URL strings (the opposite of memo23/kijiji-scraper). Plain
        // strings get rejected with "Items in input.startUrls at positions [0]
        // do not contain valid URLs".
        startUrls: [{ url: startUrl }],
        resultsLimit: cap,
        includeListingDetails: false,
      }),
      signal: AbortSignal.timeout(Math.max(options.timeoutMs ?? 0, 180_000)),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Apify Facebook actor returned ${res.status} ${res.statusText}${errBody ? `: ${errBody.slice(0, 200)}` : ''}`);
    }

    const items: any[] = await res.json();
    if (!loggedSampleItem && items.length > 0) {
      loggedSampleItem = true;
      console.log('[facebook] sample item shape:', JSON.stringify(items[0]).slice(0, 1000));
    }

    return items.slice(0, cap).map(toListing).filter((l): l is Listing => l !== null);
  },
};

function buildSearchUrl(options: SearchOptions): string {
  const resolved = resolveLocation(options.location);
  // FB accepts most lowercase-hyphenated city names; fall back to a slugified
  // raw string when our table doesn't know the location.
  const slug = resolved.facebookMarketplaceSlug
    ?? options.location.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  const params = new URLSearchParams();
  params.set('query', options.keywords);
  if (options.minPrice != null) params.set('minPrice', String(options.minPrice));
  if (options.maxPrice != null) params.set('maxPrice', String(options.maxPrice));

  return `https://www.facebook.com/marketplace/${slug}/search?${params.toString()}`;
}

function toListing(raw: any): Listing | null {
  if (!raw || typeof raw !== 'object') return null;

  // Facebook listing IDs are always strings of digits in the URL, e.g. /item/<id>/
  const id =
    raw.id ?? raw.itemId ?? raw.listingId ??
    (typeof raw.url === 'string' ? (raw.url.match(/\/item\/(\d+)/)?.[1] ?? null) : null);
  const title = raw.marketplace_listing_title ?? raw.title ?? raw.name ?? raw.custom_title;
  const rawUrl = raw.listingUrl ?? raw.url ?? raw.itemUrl;
  if (id == null || !title || !rawUrl) return null;

  const url = String(rawUrl).startsWith('http') ? String(rawUrl) : `https://www.facebook.com${rawUrl}`;

  // FB returns price under `listing_price` with `amount` (string) +
  // `formatted_amount` ("CA$45", "$45", "£45") that we use as a currency hint.
  // Other shapes preserved for forward-compat.
  let price: number | null = null;
  let currency: string | null = null;
  if (raw.listing_price && typeof raw.listing_price === 'object') {
    const amt = raw.listing_price.amount;
    if (typeof amt === 'number') price = amt;
    else if (typeof amt === 'string') price = parseFloat(amt);
    const fmt: string = raw.listing_price.formatted_amount ?? '';
    if (/^CA\$/.test(fmt)) currency = 'CAD';
    else if (/^A\$/.test(fmt)) currency = 'AUD';
    else if (/^£/.test(fmt)) currency = 'GBP';
    else if (/^€/.test(fmt)) currency = 'EUR';
    else if (/^\$/.test(fmt)) currency = 'USD';
  } else if (typeof raw.price === 'number') {
    price = raw.price;
  } else if (typeof raw.price === 'string') {
    const m = raw.price.match(/[\d,]+(?:\.\d{2})?/);
    if (m) price = parseFloat(m[0].replace(/,/g, ''));
  } else if (raw.price && typeof raw.price === 'object') {
    const v = raw.price.amount ?? raw.price.value;
    if (typeof v === 'number') price = v;
    else if (typeof v === 'string') price = parseFloat(v);
    currency = raw.price.currency ?? null;
  }
  if (!currency && typeof raw.currency === 'string') currency = raw.currency;

  const imageUrl =
    raw.primary_listing_photo?.photo_image_url ??
    raw.primary_listing_photo?.image?.uri ??
    raw.primaryPhotoUrl ??
    raw.imageUrl ??
    raw.image ??
    (Array.isArray(raw.images) ? (raw.images[0]?.url ?? raw.images[0] ?? null) : null);

  // FB nests city/state under location.reverse_geocode; fall back to flatter shapes.
  const rg = raw.location?.reverse_geocode;
  const location =
    (rg?.city && rg?.state) ? `${rg.city}, ${rg.state}` :
    rg?.city ?? rg?.city_page?.display_name ??
    raw.locationText ??
    raw.location?.text ??
    raw.location?.name ??
    (typeof raw.location === 'string' ? raw.location : null);

  // Posted timestamp: FB's GraphQL surfaces `creation_time` as a unix epoch
  // (seconds), but the Apify actor seems to expose it as a string already.
  let postedAt: string | null = null;
  if (typeof raw.creation_time === 'number') postedAt = new Date(raw.creation_time * 1000).toISOString();
  else if (typeof raw.creationTime === 'string') postedAt = raw.creationTime;
  else if (typeof raw.postedAt === 'string') postedAt = raw.postedAt;

  return {
    source: 'facebook',
    sourceId: String(id),
    title: String(title).trim(),
    url,
    price: price != null && Number.isFinite(price) ? price : null,
    currency,
    location: typeof location === 'string' ? location : null,
    description: null,
    imageUrl: typeof imageUrl === 'string' ? imageUrl : null,
    postedAt,
  };
}
