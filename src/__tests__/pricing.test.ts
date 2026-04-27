import { describe, it, expect } from 'vitest';
import { calculateSearchPrice } from '../pricing.js';
import { SOURCE_COSTS, PRICING_MARGIN_MULTIPLIER, PRICING_MINIMUM_PRICE, AMAZON_LOOKUP_COST, AMAZON_REFERENCE_LIMIT } from '../globals.js';

describe('calculateSearchPrice', () => {
  it('charges sum-of-source-costs * margin when above the minimum', () => {
    const price = calculateSearchPrice(['kijiji', 'facebook']);
    const expected = (SOURCE_COSTS.kijiji + SOURCE_COSTS.facebook) * PRICING_MARGIN_MULTIPLIER;
    expect(price).toBeCloseTo(Math.round(expected * 10000) / 10000, 4);
  });

  it('floors at PRICING_MINIMUM_PRICE for cheap source sets', () => {
    const price = calculateSearchPrice(['craigslist']);
    expect(price).toBe(PRICING_MINIMUM_PRICE);
  });

  it('grows when more sources are requested', () => {
    const cheap = calculateSearchPrice(['craigslist', 'kijiji']);
    const all = calculateSearchPrice(['craigslist', 'kijiji', 'facebook', 'ebay']);
    expect(all).toBeGreaterThan(cheap);
  });

  it('returns the minimum for an empty source list', () => {
    expect(calculateSearchPrice([])).toBe(PRICING_MINIMUM_PRICE);
  });

  it('charges extra for compareWithAmazon (worst-case cap)', () => {
    const without = calculateSearchPrice({ sources: ['craigslist', 'kijiji'] });
    const with_ = calculateSearchPrice({ sources: ['craigslist', 'kijiji'], compareWithAmazon: true });
    expect(with_).toBeGreaterThan(without);
    const expectedDelta = AMAZON_LOOKUP_COST * AMAZON_REFERENCE_LIMIT * PRICING_MARGIN_MULTIPLIER;
    // 4 decimal rounding inside calculateSearchPrice means the delta can drift
    // by up to ~5e-5; precision=3 (tolerance 5e-4) is safe.
    expect(with_ - without).toBeCloseTo(expectedDelta, 3);
  });

  it('respects estimatedAmazonLookups override', () => {
    const five = calculateSearchPrice({ sources: ['craigslist', 'kijiji'], compareWithAmazon: true, estimatedAmazonLookups: 5 });
    const cap = calculateSearchPrice({ sources: ['craigslist', 'kijiji'], compareWithAmazon: true });
    expect(five).toBeLessThan(cap);
  });
});
