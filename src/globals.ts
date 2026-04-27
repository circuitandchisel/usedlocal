import type { SourceName } from './types.js';

export const FUNDING_DESTINATION_ATXP = process.env.FUNDING_DESTINATION_ATXP;
if (!FUNDING_DESTINATION_ATXP) throw new Error('FUNDING_DESTINATION_ATXP is not set');

/**
 * Per-source underlying API/scrape cost in USD.
 *
 * These are the values we use to derive the customer-facing price (see
 * src/pricing.ts). Defaults assume realistic backends:
 *   - Craigslist: direct HTTP, effectively free.
 *   - Kijiji: routed through a paid scrape service (Apify/ScraperAPI/Playwright
 *     proxy), conservative ~$0.05/search budget.
 *   - Facebook Marketplace: Apify FB actor or equivalent, ~$0.20/search.
 *
 * Override any of these per env when you change a backend, and the price the
 * tool charges via ATXP will track automatically.
 */
export const SOURCE_COSTS: Record<SourceName, number> = {
  craigslist: process.env.SOURCE_COST_CRAIGSLIST ? parseFloat(process.env.SOURCE_COST_CRAIGSLIST) : 0.001,
  kijiji: process.env.SOURCE_COST_KIJIJI ? parseFloat(process.env.SOURCE_COST_KIJIJI) : 0.05,
  // FB Marketplace via apify/facebook-marketplace-scraper at $2.60/1k results,
  // 50-listing cap → ~$0.13/call worst case, $0.15 leaves a small buffer.
  facebook: process.env.SOURCE_COST_FACEBOOK ? parseFloat(process.env.SOURCE_COST_FACEBOOK) : 0.15,
  // eBay is national (no city filter on the actor we use); broad coverage of
  // the used market for a given keyword. ~$0.30 covers a 50-listing Apify run.
  ebay: process.env.SOURCE_COST_EBAY ? parseFloat(process.env.SOURCE_COST_EBAY) : 0.30,
};

/**
 * Per-group cost (USD) of cross-referencing a listing against Amazon for a
 * "new on Amazon" price comparison. Charged only when the search tool is
 * called with `compareWithAmazon: true`.
 */
export const AMAZON_LOOKUP_COST = process.env.AMAZON_LOOKUP_COST
  ? parseFloat(process.env.AMAZON_LOOKUP_COST)
  : 0.01;

/** Cap on how many groups we'll cross-reference against Amazon per search. */
export const AMAZON_REFERENCE_LIMIT = process.env.AMAZON_REFERENCE_LIMIT
  ? parseInt(process.env.AMAZON_REFERENCE_LIMIT)
  : 25;

/** Markup on top of summed source costs (1.25 = 25% margin). */
export const PRICING_MARGIN_MULTIPLIER = process.env.PRICING_MARGIN_MULTIPLIER
  ? parseFloat(process.env.PRICING_MARGIN_MULTIPLIER)
  : 1.25;

/** Floor price per search in USD, regardless of which sources were requested. */
export const PRICING_MINIMUM_PRICE = process.env.PRICING_MINIMUM_PRICE
  ? parseFloat(process.env.PRICING_MINIMUM_PRICE)
  : 0.02;

export const SOURCE_TIMEOUT_MS = process.env.SOURCE_TIMEOUT_MS ? parseInt(process.env.SOURCE_TIMEOUT_MS) : 30000;
export const MAX_RESULTS_PER_SOURCE = process.env.MAX_RESULTS_PER_SOURCE ? parseInt(process.env.MAX_RESULTS_PER_SOURCE) : 50;

export const MAX_CONCURRENT_TASKS = process.env.MAX_CONCURRENT_TASKS ? parseInt(process.env.MAX_CONCURRENT_TASKS) : 3;

// Many marketplaces (Craigslist, Kijiji) reject obvious bot UAs with 403.
// Default to a recent desktop-Chrome UA; override with USER_AGENT to identify yourself
// or to comply with a site's ToS.
export const USER_AGENT = process.env.USER_AGENT
  || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Apify API token used by paid scrape backends (Kijiji-Apify, optionally FB).
 * Falls back to FACEBOOK_APIFY_TOKEN for backwards-compat with the original
 * Facebook stub.
 */
export const APIFY_TOKEN = process.env.APIFY_TOKEN || process.env.FACEBOOK_APIFY_TOKEN;
export const FACEBOOK_APIFY_TOKEN = process.env.FACEBOOK_APIFY_TOKEN || process.env.APIFY_TOKEN;

/**
 * Which backend to use for the Kijiji source.
 *   - "direct": HTML scrape (no per-call cost, brittle on server IPs)
 *   - "apify":  Apify `memo23/kijiji-scraper` actor (paid, robust)
 */
export const KIJIJI_BACKEND: 'direct' | 'apify' =
  (process.env.KIJIJI_BACKEND === 'apify' ? 'apify' : 'direct');

const ALL_SOURCES: SourceName[] = ['craigslist', 'kijiji', 'facebook', 'ebay'];
const enabledRaw = (process.env.ENABLED_SOURCES || 'craigslist,kijiji,ebay').toLowerCase();
export const ENABLED_SOURCES: SourceName[] = enabledRaw
  .split(',')
  .map(s => s.trim())
  .filter((s): s is SourceName => (ALL_SOURCES as string[]).includes(s));
