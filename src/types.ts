export type SourceName = 'craigslist' | 'kijiji' | 'facebook';

export interface Listing {
  source: SourceName;
  /** Stable ID within the source (used to dedupe re-fetches of the same listing). */
  sourceId: string;
  title: string;
  /** Public, shareable URL to the listing on its source site. */
  url: string;
  /** Asking price in the listing's currency. null when the listing has no price (e.g. "free", "contact"). */
  price: number | null;
  currency: string | null;
  /** Free-text location string as provided by the source (e.g. "Mission District", "Toronto (Downtown)"). */
  location: string | null;
  /** Short text snippet/description, when available. */
  description: string | null;
  /** Primary image URL, when available. */
  imageUrl: string | null;
  /** ISO-8601 timestamp of when the listing was posted, when available. */
  postedAt: string | null;
}

export interface ListingGroup {
  /** The "best" listing in the group, used as the headline (lowest price by default). */
  primary: Listing;
  /** Other listings considered to be the same item across one or more sources. */
  duplicates: Listing[];
  /** Number of distinct sources represented in this group. */
  sourceCount: number;
}

export interface SearchOptions {
  keywords: string;
  /** Free-text location ("Toronto, ON", "San Francisco Bay Area", or a Craigslist subdomain like "sfbay"). */
  location: string;
  /** Optional minimum price filter. */
  minPrice?: number;
  /** Optional maximum price filter. */
  maxPrice?: number;
  /** Optional explicit source list. Defaults to env ENABLED_SOURCES. */
  sources?: SourceName[];
  /** Per-source timeout in ms. */
  timeoutMs?: number;
  /** Cap on raw listings per source before dedup. */
  maxPerSource?: number;
}

export interface SourceResult {
  source: SourceName;
  listings: Listing[];
  /** Non-fatal error message when the source could not be searched (e.g. unsupported location, blocked). */
  error?: string;
}

export interface ListingSource {
  name: SourceName;
  search(options: SearchOptions): Promise<Listing[]>;
}

export interface SearchResponse {
  query: { keywords: string; location: string; minPrice?: number; maxPrice?: number };
  sources: { name: SourceName; ok: boolean; count: number; error?: string }[];
  groups: ListingGroup[];
  totalListings: number;
}

export interface AsyncSearchTask {
  taskId: string;
  accountId: string;
  options: SearchOptions;
  /** Sources actually charged for at task-creation time (drives pricing). */
  pricedSources: SourceName[];
  /** Price charged in USD. Recorded for observability + audits. */
  pricedAmountUsd: number;
  status: 'pending' | 'running' | 'completed' | 'error';
  createdAt: number;
  completedAt?: number;
  result?: SearchResponse;
  errorMessage?: string;
  retryCount?: number;
}
