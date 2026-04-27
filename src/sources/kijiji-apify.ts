import type { Listing, ListingSource, SearchOptions } from '../types.js';
import { APIFY_TOKEN, MAX_RESULTS_PER_SOURCE } from '../globals.js';
import { resolveLocation } from '../locations.js';

/**
 * Kijiji backend that delegates to the Apify `memo23/kijiji-scraper` actor.
 * Apify handles Cloudflare + residential proxies for us; we just build the
 * Kijiji search URL (same scheme as the direct backend) and pass it in.
 *
 * Pricing (per Apify, at the time of writing): $0.95 per 1,000 results.
 *
 * Actor input schema:
 *   startUrls: string[]   (required — full Kijiji search URLs)
 *   maxItems:  integer    (default 10000, min 25)
 *   proxy:     { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] }
 *
 * Output schema is undocumented; we map across several plausible field names
 * for robustness and log the raw item on first call so we can tighten the
 * mapping after seeing real data.
 */

const ACTOR_ID = 'memo23~kijiji-scraper';
let loggedSampleItem = false;

export const kijijiApifySource: ListingSource = {
  name: 'kijiji',
  async search(options: SearchOptions): Promise<Listing[]> {
    if (!APIFY_TOKEN) {
      throw new Error('Kijiji-Apify backend selected but APIFY_TOKEN is not set.');
    }

    const startUrl = buildKijijiSearchUrl(options);
    const cap = options.maxPerSource ?? MAX_RESULTS_PER_SOURCE;
    // Actor min is 25; honour it even if the caller asked for fewer.
    const maxItems = Math.max(cap, 25);

    const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&clean=true`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // memo23/kijiji-scraper expects plain URL strings, not Crawlee request
        // objects — passing `[{url: "..."}]` causes a double-wrap inside the
        // actor and the run fails with "url property is not a string".
        startUrls: [startUrl],
        maxItems,
        proxy: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
      }),
      // Apify run-sync routinely takes 30–120s (actor cold-start + scrape +
      // residential proxy retries). Floor at 180s — the SOURCE_TIMEOUT_MS env
      // default is sized for cheap HTTP fetches, not actor runs.
      signal: AbortSignal.timeout(Math.max(options.timeoutMs ?? 0, 180_000)),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Apify Kijiji actor returned ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }

    const items: any[] = await res.json();
    if (!loggedSampleItem && items.length > 0) {
      loggedSampleItem = true;
      console.log('[kijiji-apify] sample item shape:', JSON.stringify(items[0]).slice(0, 1000));
    }

    return items.slice(0, cap).map(toListing).filter((l): l is Listing => l !== null);
  },
};

function buildKijijiSearchUrl(options: SearchOptions): string {
  const resolved = resolveLocation(options.location);
  const citySlug = resolved.kijijiCitySlug ?? 'canada';
  const regionId = resolved.kijijiRegionId ?? '0';
  const kwSlug = encodeURIComponent(options.keywords.trim().replace(/\s+/g, '-'));
  const path = `b-buy-sell/${citySlug}/${kwSlug}/k0c10l${regionId}`;
  const params = new URLSearchParams();
  if (options.minPrice != null) params.set('price__gte', String(options.minPrice));
  if (options.maxPrice != null) params.set('price__lte', String(options.maxPrice));
  return `https://www.kijiji.ca/${path}${params.toString() ? '?' + params.toString() : ''}`;
}

/**
 * Map an actor result to our Listing shape. The actor's output fields aren't
 * documented, so we try several plausible names for each piece of data; the
 * first defined value wins. Update once we've seen real samples.
 */
function toListing(raw: any): Listing | null {
  if (!raw || typeof raw !== 'object') return null;

  const id = raw.id ?? raw.adId ?? raw.listingId ?? raw.itemId;
  const title = raw.title ?? raw.headline ?? raw.name;
  const rawUrl = raw.url ?? raw.adUrl ?? raw.seoUrl ?? raw.webUrl ?? raw.link;
  if (id == null || !title || !rawUrl) return null;

  const url = String(rawUrl).startsWith('http') ? String(rawUrl) : `https://www.kijiji.ca${rawUrl}`;

  // Price is variously: a plain number (in dollars), a string like "$120",
  // or { amount, currency } where amount might be in cents.
  let price: number | null = null;
  let currency: string | null = null;
  if (typeof raw.price === 'number') {
    price = raw.price;
  } else if (typeof raw.price === 'string') {
    const n = parseFloat(raw.price.replace(/[^\d.]/g, ''));
    price = Number.isFinite(n) ? n : null;
  } else if (raw.price && typeof raw.price === 'object') {
    const amt = raw.price.amount ?? raw.price.value;
    if (typeof amt === 'number') {
      // Kijiji's __NEXT_DATA__ uses cents; some actor outputs preserve that.
      // Heuristic: if the value is a clean multiple of 100 and > 1000, assume cents.
      price = amt > 1000 && amt % 100 === 0 ? amt / 100 : amt;
    }
    currency = raw.price.currency ?? null;
  } else if (typeof raw.priceAmount === 'number') {
    price = raw.priceAmount;
  }

  const imageUrl =
    (Array.isArray(raw.images) && raw.images[0]?.url) ||
    (Array.isArray(raw.imageUrls) && raw.imageUrls[0]) ||
    raw.image?.url ||
    raw.imageUrl ||
    raw.primaryImage ||
    null;

  const location =
    raw.location?.name ??
    raw.location?.areaName ??
    raw.location?.text ??
    raw.locationName ??
    (typeof raw.location === 'string' ? raw.location : null);

  const postedAt =
    raw.activationDate ??
    raw.postedDate ??
    raw.creationDate ??
    raw.createdAt ??
    null;

  const description = raw.description ? String(raw.description).slice(0, 500) : null;

  return {
    source: 'kijiji',
    sourceId: String(id),
    title: String(title).trim(),
    url,
    price: price != null && Number.isFinite(price) ? price : null,
    currency: currency ?? (price != null ? 'CAD' : null),
    location: location ? String(location) : null,
    description,
    imageUrl,
    postedAt: postedAt ? String(postedAt) : null,
  };
}
