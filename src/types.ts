export type SourceName = 'craigslist' | 'kijiji' | 'facebook' | 'ebay';

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
  /**
   * Cross-reference to the same item new on Amazon (only present when the
   * caller passed `compareWithAmazon: true`). Use this to see whether the
   * asking price on used listings is sane vs. the new-product market.
   */
  amazonReference?: AmazonReference;
}

export interface AmazonReference {
  /** Title of the top Amazon result. */
  title: string;
  /** Public Amazon product URL (an /dp/<asin> link). */
  url: string;
  /** Listing price on Amazon in USD, if present. null when Amazon shows no fixed price (e.g. "currently unavailable"). */
  price: number | null;
  currency: string | null;
  /** Image URL for the Amazon product, if present. */
  imageUrl: string | null;
  /**
   * How confident we are that the Amazon result actually matches the used listing.
   *   high   — title-token Jaccard ≥ 0.5
   *   medium — title-token Jaccard ≥ 0.3
   *   low    — anything less; treat the comparison with suspicion
   */
  confidence: 'high' | 'medium' | 'low';
  /** Jaccard similarity between the used-listing title and the Amazon result title, [0,1]. */
  titleSimilarity: number;
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
  /** When true, attach an `amazonReference` to each ListingGroup. Off by default; raises the call price. */
  compareWithAmazon?: boolean;
  /** Cap on the number of groups we'll cross-reference against Amazon (top-N by source coverage). Default 25. */
  amazonReferenceLimit?: number;
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
