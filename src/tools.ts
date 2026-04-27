import { defineTool, captureToolExecution, getPostHogInstance } from '@longrun/turtle';
import { atxpAccountId, requirePayment } from '@atxp/server';
import BigNumber from 'bignumber.js';
import { z } from 'zod';
import { searchListings } from './search.js';
import { SEARCH_COST } from './globals.js';
import type { SourceName } from './types.js';

const SearchParameters = z.object({
  keywords: z.string().min(1).max(200).describe(
    'Keywords to search for in listing titles/descriptions, e.g. "ikea desk", "dewalt drill", "1990 toyota truck".'
  ),
  location: z.string().min(2).max(100).describe(
    'Location to search around. Accepts a major city name ("Toronto", "San Francisco", "Seattle") ' +
    'or a Craigslist subdomain directly ("sfbay", "newyork"). Used to pick per-source regions.'
  ),
  minPrice: z.number().int().nonnegative().optional().describe('Minimum asking price filter.'),
  maxPrice: z.number().int().nonnegative().optional().describe('Maximum asking price filter.'),
  sources: z.array(z.enum(['craigslist', 'kijiji', 'facebook']))
    .optional()
    .describe('Sources to query. Defaults to the server\'s ENABLED_SOURCES (typically craigslist + kijiji).'),
  maxPerSource: z.number().int().positive().max(200).optional().describe('Cap on raw listings per source before dedup. Default 50.'),
});

export const searchListingsTool = defineTool(
  'usedlocal_search',
  'Searches local used-goods marketplaces (Craigslist, Kijiji, optionally Facebook Marketplace) for listings ' +
  'matching the given keywords near a location, then groups duplicate listings across sources. ' +
  'Returns a list of groups, each with a primary listing (lowest price) and a list of duplicate listings. ' +
  'All URLs are publicly shareable links to the original source. Source-level errors are non-fatal: ' +
  'if Kijiji is blocked, Craigslist results are still returned, with the error reported in the response.',
  SearchParameters,
  async ({ keywords, location, minPrice, maxPrice, sources, maxPerSource }) => {
    const accountId = atxpAccountId();
    if (!accountId) throw new Error('Authenticated user is required');

    const posthog = getPostHogInstance();
    const startTime = Date.now();
    await captureToolExecution(posthog, accountId, { tool_name: 'usedlocal_search', status: 'started' });

    try {
      if (SEARCH_COST > 0) {
        await requirePayment({ price: BigNumber(SEARCH_COST) });
      }

      const result = await searchListings({
        keywords,
        location,
        minPrice,
        maxPrice,
        sources: sources as SourceName[] | undefined,
        maxPerSource,
      });

      await captureToolExecution(posthog, accountId, {
        tool_name: 'usedlocal_search',
        status: 'success',
        duration_ms: Date.now() - startTime,
      });

      return JSON.stringify(result);
    } catch (error) {
      await captureToolExecution(posthog, accountId, {
        tool_name: 'usedlocal_search',
        status: 'error',
        duration_ms: Date.now() - startTime,
        error_message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
);
