import { describe, it, expect } from 'vitest';
import { resolveLocation } from '../locations.js';

describe('resolveLocation', () => {
  it('accepts a Craigslist subdomain directly', () => {
    expect(resolveLocation('sfbay').craigslistSubdomain).toBe('sfbay');
  });

  it('maps "San Francisco" to sfbay', () => {
    expect(resolveLocation('San Francisco').craigslistSubdomain).toBe('sfbay');
  });

  it('handles "Toronto, ON" for both Craigslist and Kijiji', () => {
    const r = resolveLocation('Toronto, ON');
    expect(r.craigslistSubdomain).toBe('toronto');
    expect(r.kijijiRegionId).toBe('1700273');
    expect(r.kijijiCitySlug).toBe('city-of-toronto');
  });

  it('returns null for unknown locations rather than throwing', () => {
    const r = resolveLocation('Nowhereville, NW');
    expect(r.craigslistSubdomain).toBeNull();
    expect(r.kijijiRegionId).toBeNull();
  });
});
