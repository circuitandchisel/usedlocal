import type { Listing, ListingSource, SearchOptions } from '../types.js';
import { FACEBOOK_APIFY_TOKEN, MAX_RESULTS_PER_SOURCE } from '../globals.js';

/**
 * Facebook Marketplace requires authentication for both browsing and the
 * underlying GraphQL endpoints. We don't ship a browser-automation pipeline
 * inside the MCP server; instead, when a `FACEBOOK_APIFY_TOKEN` is present we
 * proxy the search through the Apify "facebook-marketplace-scraper" actor,
 * which handles login + anti-bot externally.
 *
 * Without the token, this source returns a non-fatal error so the orchestrator
 * can still return Craigslist + Kijiji results and the client knows why FB is
 * empty.
 */
export const facebookSource: ListingSource = {
  name: 'facebook',
  async search(options: SearchOptions): Promise<Listing[]> {
    if (!FACEBOOK_APIFY_TOKEN) {
      throw new Error(
        'Facebook Marketplace requires FACEBOOK_APIFY_TOKEN (or another auth-bearing proxy). ' +
        'See README; this source is a stub when no token is configured.'
      );
    }
    return runApifyActor(options);
  },
};

async function runApifyActor(options: SearchOptions): Promise<Listing[]> {
  const cap = options.maxPerSource ?? MAX_RESULTS_PER_SOURCE;
  const input = {
    search: options.keywords,
    location: options.location,
    minPrice: options.minPrice,
    maxPrice: options.maxPrice,
    maxItems: cap,
  };

  const startUrl = `https://api.apify.com/v2/acts/junglee~facebook-marketplace/run-sync-get-dataset-items?token=${FACEBOOK_APIFY_TOKEN}`;
  const res = await fetch(startUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(options.timeoutMs ?? 60000),
  });
  if (!res.ok) {
    throw new Error(`Apify Facebook actor returned ${res.status} ${res.statusText}`);
  }
  const items: any[] = await res.json();

  return items.slice(0, cap).map((it: any) => {
    const url = String(it.listingUrl ?? it.url ?? '').trim();
    const idMatch = url.match(/\/item\/(\d+)/);
    return {
      source: 'facebook' as const,
      sourceId: it.id ? String(it.id) : (idMatch ? idMatch[1] : url),
      title: String(it.title ?? it.marketplace_listing_title ?? '').trim(),
      url,
      price: typeof it.price === 'number' ? it.price : (it.price?.amount ?? null),
      currency: it.currency ?? it.price?.currency ?? null,
      location: it.location?.text ?? it.locationText ?? null,
      description: it.description ? String(it.description).slice(0, 500) : null,
      imageUrl: it.primary_listing_photo?.image?.uri ?? it.imageUrl ?? null,
      postedAt: it.creation_time ? new Date(it.creation_time * 1000).toISOString() : null,
    };
  }).filter((l) => l.title && l.url);
}
