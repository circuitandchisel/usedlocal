import { describe, it, expect } from 'vitest';
import { groupListings, jaccard, titleTokens } from '../dedup.js';
import type { Listing } from '../types.js';

function L(partial: Partial<Listing> & { source: Listing['source']; sourceId: string; title: string; url: string }): Listing {
  return {
    price: null,
    currency: null,
    location: null,
    description: null,
    imageUrl: null,
    postedAt: null,
    ...partial,
  };
}

describe('jaccard', () => {
  it('returns 1 for identical sets', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
  });
  it('returns 0 for disjoint sets', () => {
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
  });
  it('returns intersection over union', () => {
    expect(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toBeCloseTo(2 / 4);
  });
});

describe('titleTokens', () => {
  it('drops stopwords and short words', () => {
    expect(titleTokens('A great Used IKEA Bekant desk for sale')).toEqual(new Set(['ikea', 'bekant', 'desk']));
  });
});

describe('groupListings', () => {
  it('merges near-identical titles across sources', () => {
    const listings = [
      L({ source: 'craigslist', sourceId: 'c1', title: 'IKEA Bekant Desk White', url: 'https://cl/1', price: 120 }),
      L({ source: 'kijiji', sourceId: 'k1', title: 'IKEA Bekant white desk', url: 'https://k/1', price: 130 }),
      L({ source: 'craigslist', sourceId: 'c2', title: 'Dewalt cordless drill kit', url: 'https://cl/2', price: 80 }),
    ];
    const groups = groupListings(listings);
    expect(groups).toHaveLength(2);
    const desk = groups.find((g) => g.primary.title.toLowerCase().includes('desk'))!;
    expect(desk.duplicates).toHaveLength(1);
    expect(desk.sourceCount).toBe(2);
    expect(desk.primary.price).toBe(120); // lowest price wins
  });

  it('does not merge listings with very different prices', () => {
    const listings = [
      L({ source: 'craigslist', sourceId: 'c1', title: 'IKEA Bekant Desk', url: 'https://cl/1', price: 100 }),
      L({ source: 'kijiji', sourceId: 'k1', title: 'IKEA Bekant Desk', url: 'https://k/1', price: 500 }),
    ];
    const groups = groupListings(listings);
    expect(groups).toHaveLength(2);
  });

  it('treats null prices as compatible', () => {
    const listings = [
      L({ source: 'craigslist', sourceId: 'c1', title: 'Vintage Marshall amp', url: 'https://cl/1', price: 400 }),
      L({ source: 'kijiji', sourceId: 'k1', title: 'vintage marshall amp', url: 'https://k/1', price: null }),
    ];
    const groups = groupListings(listings);
    expect(groups).toHaveLength(1);
  });

  it('deduplicates same source+sourceId even with very different titles', () => {
    const listings = [
      L({ source: 'craigslist', sourceId: 'same', title: 'Old listing title', url: 'https://cl/1' }),
      L({ source: 'craigslist', sourceId: 'same', title: 'Updated listing title', url: 'https://cl/1' }),
    ];
    const groups = groupListings(listings);
    expect(groups).toHaveLength(1);
  });
});
