import type { Listing, ListingSource, SearchOptions } from '../types.js';
import { USER_AGENT, MAX_RESULTS_PER_SOURCE } from '../globals.js';
import { resolveLocation } from '../locations.js';

/**
 * Kijiji has no public API and uses Cloudflare. We do a best-effort HTML fetch
 * and parse the embedded Next.js `__NEXT_DATA__` JSON, which contains the
 * listings the page would otherwise render. When Kijiji blocks us (403 / a
 * challenge page), we surface that as a non-fatal error so the orchestrator
 * can still return Craigslist results.
 *
 * URL pattern:
 *   https://www.kijiji.ca/b-buy-sell/{citySlug}/{keywords}/k0c10l{regionId}
 *   (c10 = "Buy & Sell", l<id> = location id)
 */
export const kijijiSource: ListingSource = {
  name: 'kijiji',
  async search(options: SearchOptions): Promise<Listing[]> {
    const resolved = resolveLocation(options.location);
    const citySlug = resolved.kijijiCitySlug ?? 'canada';
    const regionId = resolved.kijijiRegionId ?? '0';
    const kwSlug = encodeURIComponent(options.keywords.trim().replace(/\s+/g, '-'));

    let path = `b-buy-sell/${citySlug}/${kwSlug}/k0c10l${regionId}`;
    const params = new URLSearchParams();
    if (options.minPrice != null) params.set('price__gte', String(options.minPrice));
    if (options.maxPrice != null) params.set('price__lte', String(options.maxPrice));
    const url = `https://www.kijiji.ca/${path}${params.toString() ? '?' + params.toString() : ''}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-CA,en;q=0.9',
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
    });
    if (!res.ok) {
      throw new Error(`Kijiji returned ${res.status} ${res.statusText}`);
    }
    const html = await res.text();

    // Detect Cloudflare interstitial early — it returns 200 OK with a JS challenge.
    if (/cf-browser-verification|cf-challenge|Just a moment\.\.\./i.test(html)) {
      throw new Error('Kijiji served a Cloudflare challenge; consider running through a proxy.');
    }

    const data = extractNextData(html);
    if (!data) {
      // Fall back to lightweight regex over the SSR HTML so we still return *something*.
      return parseListingsFromHtml(html, options);
    }

    const cap = options.maxPerSource ?? MAX_RESULTS_PER_SOURCE;
    const rawListings = collectListingsFromNextData(data).slice(0, cap);
    return rawListings.map(toListing).filter((x): x is Listing => x !== null);
  },
};

function extractNextData(html: string): any | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/**
 * Walk the __NEXT_DATA__ tree looking for objects shaped like a Kijiji listing.
 * The shape changes between page versions; we look for any object with both
 * `id` (or `adId`) and `url`-ish + `title`.
 */
function collectListingsFromNextData(root: any): any[] {
  const out: any[] = [];
  const seen = new Set<string>();
  const stack: any[] = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child);
      continue;
    }
    const id = node.id ?? node.adId ?? node.listingId;
    const title = node.title ?? node.headline;
    const url = node.url ?? node.seoUrl ?? node.webUrl;
    if (id && title && typeof url === 'string' && url.includes('/v-')) {
      const key = String(id);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(node);
      }
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return out;
}

function toListing(raw: any): Listing | null {
  const id = String(raw.id ?? raw.adId ?? raw.listingId ?? '');
  const title = String(raw.title ?? raw.headline ?? '').trim();
  const rawUrl = String(raw.url ?? raw.seoUrl ?? raw.webUrl ?? '').trim();
  if (!id || !title || !rawUrl) return null;
  const url = rawUrl.startsWith('http') ? rawUrl : `https://www.kijiji.ca${rawUrl}`;

  // Kijiji's __NEXT_DATA__ stores price.amount in *cents*; other shapes (priceAmount, price.value)
  // are typically already in dollars. Detect by source field.
  let price: number | null = null;
  if (typeof raw.price?.amount === 'number') {
    price = raw.price.amount / 100;
  } else if (typeof raw.priceAmount === 'number') {
    price = raw.priceAmount;
  } else if (typeof raw.price?.value === 'number') {
    price = raw.price.value;
  } else if (typeof raw.price === 'number') {
    price = raw.price;
  } else if (typeof raw.price === 'string') {
    const n = parseFloat(raw.price.replace(/[^\d.]/g, ''));
    price = Number.isFinite(n) ? n : null;
  }

  const imageUrl = raw.imageUrls?.[0] ?? raw.image?.url ?? raw.images?.[0]?.url ?? null;
  const location = raw.location?.name ?? raw.location?.areaName ?? raw.locationName ?? null;
  const postedAt = raw.activationDate ?? raw.postedDate ?? raw.creationDate ?? null;
  const description = raw.description ? String(raw.description).slice(0, 500) : null;

  return {
    source: 'kijiji',
    sourceId: id,
    title,
    url,
    price: price != null && Number.isFinite(price) ? price : null,
    currency: price != null && Number.isFinite(price) ? 'CAD' : null,
    location,
    description,
    imageUrl,
    postedAt,
  };
}

/** Last-ditch HTML scrape when __NEXT_DATA__ isn't present. */
function parseListingsFromHtml(html: string, options: SearchOptions): Listing[] {
  const cap = options.maxPerSource ?? MAX_RESULTS_PER_SOURCE;
  const out: Listing[] = [];
  const re = /<a[^>]+data-testid="listing-link"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < cap) {
    const href = m[1];
    const title = m[2].trim();
    const idMatch = href.match(/\/(\d{8,})(?:[\/?#]|$)/);
    out.push({
      source: 'kijiji',
      sourceId: idMatch ? idMatch[1] : href,
      title,
      url: href.startsWith('http') ? href : `https://www.kijiji.ca${href}`,
      price: null,
      currency: null,
      location: null,
      description: null,
      imageUrl: null,
      postedAt: null,
    });
  }
  return out;
}
