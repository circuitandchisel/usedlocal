import type { SourceName } from './types.js';
import {
  SOURCE_COSTS,
  PRICING_MARGIN_MULTIPLIER,
  PRICING_MINIMUM_PRICE,
  AMAZON_LOOKUP_COST,
  AMAZON_REFERENCE_LIMIT,
} from './globals.js';

interface PricingInput {
  sources: SourceName[];
  /** When true, the search will run an Amazon lookup per group; price scales with group count. */
  compareWithAmazon?: boolean;
  /**
   * Estimated number of groups we'll cross-reference against Amazon. At
   * task-creation time we don't know yet — pass `AMAZON_REFERENCE_LIMIT` to
   * charge the worst case (it's what the orchestrator caps to anyway).
   */
  estimatedAmazonLookups?: number;
}

/**
 * Customer-facing price for a search.
 *
 *   base   = sum(SOURCE_COSTS[s]) for s in sources
 *   amazon = compareWithAmazon ? AMAZON_LOOKUP_COST * estimatedAmazonLookups : 0
 *   price  = max((base + amazon) * PRICING_MARGIN_MULTIPLIER, PRICING_MINIMUM_PRICE)
 *
 * All cost knobs are env-tunable so swapping a source's backend (or the
 * Amazon actor) widens the ATXP charge without code changes.
 */
export function calculateSearchPrice(input: PricingInput | SourceName[]): number {
  // Back-compat: original signature was just an array of source names.
  const args: PricingInput = Array.isArray(input) ? { sources: input } : input;

  const baseCost = args.sources.reduce((sum, s) => sum + (SOURCE_COSTS[s] ?? 0), 0);
  const amazonCost = args.compareWithAmazon
    ? AMAZON_LOOKUP_COST * (args.estimatedAmazonLookups ?? AMAZON_REFERENCE_LIMIT)
    : 0;

  const total = (baseCost + amazonCost) * PRICING_MARGIN_MULTIPLIER;
  const price = Math.max(total, PRICING_MINIMUM_PRICE);
  return Math.round(price * 10000) / 10000;
}
