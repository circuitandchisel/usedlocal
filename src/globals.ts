import type { SourceName } from './types.js';

export const FUNDING_DESTINATION_ATXP = process.env.FUNDING_DESTINATION_ATXP;
if (!FUNDING_DESTINATION_ATXP) throw new Error('FUNDING_DESTINATION_ATXP is not set');

export const SEARCH_COST = process.env.SEARCH_COST ? parseFloat(process.env.SEARCH_COST) : 0.02;

export const SOURCE_TIMEOUT_MS = process.env.SOURCE_TIMEOUT_MS ? parseInt(process.env.SOURCE_TIMEOUT_MS) : 15000;
export const MAX_RESULTS_PER_SOURCE = process.env.MAX_RESULTS_PER_SOURCE ? parseInt(process.env.MAX_RESULTS_PER_SOURCE) : 50;

// Many marketplaces (Craigslist, Kijiji) reject obvious bot UAs with 403.
// Default to a recent desktop-Chrome UA; override with USER_AGENT to identify yourself
// or to comply with a site's ToS.
export const USER_AGENT = process.env.USER_AGENT
  || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const FACEBOOK_APIFY_TOKEN = process.env.FACEBOOK_APIFY_TOKEN;

const ALL_SOURCES: SourceName[] = ['craigslist', 'kijiji', 'facebook'];
const enabledRaw = (process.env.ENABLED_SOURCES || 'craigslist,kijiji').toLowerCase();
export const ENABLED_SOURCES: SourceName[] = enabledRaw
  .split(',')
  .map(s => s.trim())
  .filter((s): s is SourceName => (ALL_SOURCES as string[]).includes(s));
