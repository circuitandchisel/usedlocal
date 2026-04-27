import type { Listing, ListingSource, SearchOptions, SearchResponse, SourceName } from './types.js';
import { ENABLED_SOURCES, KIJIJI_BACKEND, MAX_RESULTS_PER_SOURCE, SOURCE_TIMEOUT_MS } from './globals.js';
import { craigslistSource } from './sources/craigslist.js';
import { kijijiSource } from './sources/kijiji.js';
import { kijijiApifySource } from './sources/kijiji-apify.js';
import { facebookSource } from './sources/facebook.js';
import { groupListings } from './dedup.js';

const SOURCES: Record<SourceName, ListingSource> = {
  craigslist: craigslistSource,
  kijiji: KIJIJI_BACKEND === 'apify' ? kijijiApifySource : kijijiSource,
  facebook: facebookSource,
};

export async function searchListings(opts: SearchOptions): Promise<SearchResponse> {
  const wantedSources = (opts.sources && opts.sources.length > 0 ? opts.sources : ENABLED_SOURCES);
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
  return {
    query: { keywords: opts.keywords, location: opts.location, minPrice: opts.minPrice, maxPrice: opts.maxPrice },
    sources: sourceStatuses,
    groups,
    totalListings: allListings.length,
  };
}
