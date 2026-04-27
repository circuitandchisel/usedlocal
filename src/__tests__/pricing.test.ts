import { describe, it, expect } from 'vitest';
import { calculateSearchPrice } from '../pricing.js';
import { SOURCE_COSTS, PRICING_MARGIN_MULTIPLIER, PRICING_MINIMUM_PRICE } from '../globals.js';

describe('calculateSearchPrice', () => {
  it('charges sum-of-source-costs * margin when above the minimum', () => {
    const price = calculateSearchPrice(['kijiji', 'facebook']);
    const expected = (SOURCE_COSTS.kijiji + SOURCE_COSTS.facebook) * PRICING_MARGIN_MULTIPLIER;
    expect(price).toBeCloseTo(Math.round(expected * 10000) / 10000, 4);
  });

  it('floors at PRICING_MINIMUM_PRICE for cheap source sets', () => {
    // Craigslist alone is well under the minimum at default rates.
    const price = calculateSearchPrice(['craigslist']);
    expect(price).toBe(PRICING_MINIMUM_PRICE);
  });

  it('grows when more sources are requested', () => {
    const cheap = calculateSearchPrice(['craigslist', 'kijiji']);
    const all = calculateSearchPrice(['craigslist', 'kijiji', 'facebook']);
    expect(all).toBeGreaterThan(cheap);
  });

  it('returns the minimum for an empty source list', () => {
    expect(calculateSearchPrice([])).toBe(PRICING_MINIMUM_PRICE);
  });
});
