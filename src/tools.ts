import { defineTool, captureToolExecution, getPostHogInstance } from '@longrun/turtle';
import { atxpAccountId, requirePayment } from '@atxp/server';
import BigNumber from 'bignumber.js';
import { z } from 'zod';
import { ENABLED_SOURCES } from './globals.js';
import { calculateSearchPrice } from './pricing.js';
import { AsyncSearchService } from './async-search.js';
import type { SourceName } from './types.js';

const SearchAsyncParameters = z.object({
  keywords: z.string().min(1).max(200).describe(
    'Keywords to search for in listing titles/descriptions, e.g. "ikea desk", "dewalt drill", "1990 toyota truck".'
  ),
  location: z.string().min(2).max(100).describe(
    'Location to search around. Accepts a major city name ("Toronto", "San Francisco", "Seattle") ' +
    'or a Craigslist subdomain directly ("sfbay", "newyork"). Used to pick per-source regions.'
  ),
  minPrice: z.number().int().nonnegative().optional().describe('Minimum asking price filter.'),
  maxPrice: z.number().int().nonnegative().optional().describe('Maximum asking price filter.'),
  sources: z.array(z.enum(['craigslist', 'kijiji', 'facebook', 'ebay']))
    .optional()
    .describe(
      'Sources to query. Defaults to the server\'s ENABLED_SOURCES (typically craigslist + kijiji + ebay). ' +
      '"facebook" requires the server to be configured with a Marketplace backend; "ebay" is national ' +
      '(no city filter) and broadens used-market coverage. Each enabled source increases the price of the ' +
      'call to cover its underlying scrape/API cost.'
    ),
  maxPerSource: z.number().int().positive().max(200).optional().describe('Cap on raw listings per source before dedup. Default 50.'),
  compareWithAmazon: z.boolean().optional().describe(
    'When true, attach an `amazonReference` to each grouped listing showing the same item\'s "new on Amazon" ' +
    'price (top search hit + a confidence score in {high, medium, low} based on title-token similarity). ' +
    'Off by default. Significantly raises the price of the call (one Amazon lookup per group, capped at ~25). ' +
    'Use this to surface listings where the asking price is at-or-above the new-product market price.'
  ),
  amazonReferenceLimit: z.number().int().positive().max(50).optional().describe(
    'Cap on how many groups to cross-reference against Amazon when `compareWithAmazon` is true. Default 25.'
  ),
});

let asyncSearchService: AsyncSearchService | null = null;

export function setAsyncSearchService(service: AsyncSearchService) {
  asyncSearchService = service;
}

export const searchAsyncTool = defineTool(
  'usedlocal_search_async',
  'Starts an asynchronous search across local used-goods marketplaces (Craigslist, Kijiji, optionally ' +
  'Facebook Marketplace) for listings matching the given keywords near a location. Returns a `taskId` ' +
  'that you must pass to `usedlocal_get_async` to fetch the grouped results when the search completes. ' +
  'Pricing is dynamic: the call is charged for the union of sources requested, with each source\'s ' +
  'underlying scrape/API cost passed through plus a margin. Cross-source duplicate listings are merged ' +
  'before they\'re returned, so the final group list is deduped across all enabled sources.',
  SearchAsyncParameters,
  async ({ keywords, location, minPrice, maxPrice, sources, maxPerSource, compareWithAmazon, amazonReferenceLimit }) => {
    if (!asyncSearchService) throw new Error('Async search service not initialized');

    const accountId = atxpAccountId();
    if (!accountId) throw new Error('Authenticated user is required');

    const posthog = getPostHogInstance();
    const startTime = Date.now();
    await captureToolExecution(posthog, accountId, { tool_name: 'usedlocal_search_async', status: 'started' });

    try {
      const requestedSources: SourceName[] = (sources && sources.length > 0)
        ? (sources as SourceName[])
        : ENABLED_SOURCES;

      // Charge upfront based on the actual sources this search will hit + the
      // (capped) cost of Amazon cross-references. Pricing covers backend cost
      // + margin (see globals.SOURCE_COSTS / AMAZON_LOOKUP_COST).
      const price = calculateSearchPrice({
        sources: requestedSources,
        compareWithAmazon,
        estimatedAmazonLookups: amazonReferenceLimit,
      });
      if (price > 0) {
        await requirePayment({ price: BigNumber(price) });
      }

      const taskId = await asyncSearchService.createTask(
        accountId,
        {
          keywords,
          location,
          minPrice,
          maxPrice,
          sources: requestedSources,
          maxPerSource,
          compareWithAmazon,
          amazonReferenceLimit,
        },
        requestedSources,
        price,
      );

      await captureToolExecution(posthog, accountId, {
        tool_name: 'usedlocal_search_async',
        status: 'success',
        duration_ms: Date.now() - startTime,
      });

      return JSON.stringify({ taskId, pricedSources: requestedSources, pricedAmountUsd: price });
    } catch (err) {
      await captureToolExecution(posthog, accountId, {
        tool_name: 'usedlocal_search_async',
        status: 'error',
        duration_ms: Date.now() - startTime,
        error_message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
);

const GetAsyncParameters = z.object({
  taskId: z.string().describe('The task ID returned from `usedlocal_search_async`.'),
});

export const getAsyncTool = defineTool(
  'usedlocal_get_async',
  'Retrieves the status and (when complete) the grouped results of an async search started with ' +
  '`usedlocal_search_async`. Status is one of `pending`, `running`, `completed`, or `error`. When ' +
  'completed, the response includes the full grouped result; when error, an `errorMessage` is included.',
  GetAsyncParameters,
  async ({ taskId }) => {
    if (!asyncSearchService) throw new Error('Async search service not initialized');

    const accountId = atxpAccountId();
    if (!accountId) throw new Error('Authenticated user is required');

    const posthog = getPostHogInstance();
    const startTime = Date.now();
    await captureToolExecution(posthog, accountId, { tool_name: 'usedlocal_get_async', status: 'started' });

    try {
      const task = await asyncSearchService.getTask(taskId);
      if (!task) throw new Error(`Task ${taskId} not found or has expired`);

      await captureToolExecution(posthog, accountId, {
        tool_name: 'usedlocal_get_async',
        status: 'success',
        duration_ms: Date.now() - startTime,
      });

      return JSON.stringify({
        status: task.status,
        result: task.result,
        errorMessage: task.errorMessage,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
      });
    } catch (err) {
      await captureToolExecution(posthog, accountId, {
        tool_name: 'usedlocal_get_async',
        status: 'error',
        duration_ms: Date.now() - startTime,
        error_message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
);
