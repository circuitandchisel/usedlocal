import type { Listing, ListingGroup, ListingSource, SearchOptions, SearchResponse, SourceName } from './types.js';
import {
  AMAZON_REFERENCE_LIMIT,
  ENABLED_SOURCES,
  KIJIJI_BACKEND,
  MAX_RESULTS_PER_SOURCE,
  SOURCE_TIMEOUT_MS,
} from './globals.js';
import { craigslistSource } from './sources/craigslist.js';
import { kijijiSource } from './sources/kijiji.js';
import { kijijiApifySource } from './sources/kijiji-apify.js';
import { facebookSource } from './sources/facebook.js';
import { ebayApifySource } from './sources/ebay-apify.js';
import { groupListings } from './dedup.js';
import { amazonLookup } from './amazon.js';

const SOURCES: Record<SourceName, ListingSource> = {
  craigslist: craigslistSource,
  kijiji: KIJIJI_BACKEND === 'apify' ? kijijiApifySource : kijijiSource,
  facebook: facebookSource,
  ebay: ebayApifySource,
};

export async function searchListings(opts: SearchOptions): Promise<SearchResponse> {
  const wantedSources = opts.sources && opts.sources.length > 0 ? opts.sources : ENABLED_SOURCES;
  const timeoutMs = opts.timeoutMs ?? SOURCE_TIMEOUT_MS;
  const maxPerSource = opts.maxPerSource ?? MAX_RESULTS_PER_SOURCE;

  const settled = await Promise.allSettled(
    wantedSources.map((name) =>
      SOURCES[name].search({ ...opts, timeoutMs, maxPerSource }).then((listings) => ({ name, listings }))
    )
  );

  const sourceStatuses: SearchResponse['sources'] = [];
  const allListings: Listing[] = [];
  for (let i = 0; i < settled.length; i++) {
    const name = wantedSources[i];
    const r = settled[i];
    if (r.status === 'fulfilled') {
      sourceStatuses.push({ name, ok: true, count: r.value.listings.length });
      allListings.push(...r.value.listings);
    } else {
      const err = r.reason instanceof Error ? r.reason.message : String(r.reason);
      sourceStatuses.push({ name, ok: false, count: 0, error: err });
    }
  }

  const groups = groupListings(allListings);

  if (opts.compareWithAmazon) {
    await attachAmazonReferences(groups, opts.amazonReferenceLimit ?? AMAZON_REFERENCE_LIMIT);
  }

  return {
    query: { keywords: opts.keywords, location: opts.location, minPrice: opts.minPrice, maxPrice: opts.maxPrice },
    sources: sourceStatuses,
    groups,
    totalListings: allListings.length,
  };
}

/**
 * Run an Amazon lookup for the top-N groups (already sorted by source coverage
 * + price ascending in `groupListings`). Lookups run in parallel with
 * Promise.allSettled so a single failure doesn't poison the whole search.
 */
async function attachAmazonReferences(groups: ListingGroup[], limit: number): Promise<void> {
  const targets = groups.slice(0, Math.max(0, limit));
  if (targets.length === 0) return;

  const results = await Promise.allSettled(
    targets.map((g) => amazonLookup(g.primary.title))
  );

  for (let i = 0; i < targets.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value) {
      targets[i].amazonReference = r.value;
    } else if (r.status === 'rejected') {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.warn(`[amazon] lookup failed for "${targets[i].primary.title.slice(0, 60)}": ${msg}`);
    }
  }
}
