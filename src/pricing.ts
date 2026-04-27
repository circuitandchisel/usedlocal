import type { SourceName } from './types.js';
import { SOURCE_COSTS, PRICING_MARGIN_MULTIPLIER, PRICING_MINIMUM_PRICE } from './globals.js';

/**
 * Customer-facing price for a search across the given sources.
 *
 *   price = max(sum(source_costs) * margin, minimum)
 *
 * Source costs are configured per env in `globals.ts` so that swapping a
 * source's backend (direct HTTP → Apify → Playwright + proxy) is a one-line
 * config change that automatically widens the ATXP charge.
 */
export function calculateSearchPrice(sources: SourceName[]): number {
  const total = sources.reduce((sum, s) => sum + (SOURCE_COSTS[s] ?? 0), 0);
  const withMargin = total * PRICING_MARGIN_MULTIPLIER;
  const price = Math.max(withMargin, PRICING_MINIMUM_PRICE);
  // Round to 4 decimals so we don't carry floating-point fuzz into BigNumber.
  return Math.round(price * 10000) / 10000;
}
