import { describe, it, expect } from 'vitest';
import { titleTokens, jaccard } from '../dedup.js';

/**
 * The Amazon lookup itself is a network call, so we don't test it here. What
 * we do test is the confidence-scoring logic — derived from the same
 * dedup helpers — to make sure our `high/medium/low` thresholds align with
 * intuition.
 */
function classify(listingTitle: string, amazonTitle: string): 'high' | 'medium' | 'low' {
  const sim = jaccard(titleTokens(listingTitle), titleTokens(amazonTitle));
  return sim >= 0.5 ? 'high' : sim >= 0.3 ? 'medium' : 'low';
}

describe('amazon match confidence', () => {
  it('rates an exact-name match as high', () => {
    expect(classify('IKEA Bekant Desk White', 'IKEA Bekant Desk, White Stained Oak Veneer')).toBe('high');
  });

  it('rates a same-brand-different-product match as low or medium', () => {
    const c = classify('Vintage Marshall amp', 'Marshall MG30CFX 30W Combo Amplifier');
    expect(['low', 'medium']).toContain(c);
  });

  it('rates an unrelated top result as low', () => {
    expect(classify('Dewalt 18V cordless drill', 'Stanley Hammer 16oz Steel')).toBe('low');
  });

  it('rates a strong tool-model match as high', () => {
    expect(classify('Dewalt DCD771 cordless drill', 'DEWALT DCD771 Cordless Drill 20V MAX')).toBe('high');
  });
});
