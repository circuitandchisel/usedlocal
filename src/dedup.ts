import type { Listing, ListingGroup } from './types.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'with', 'in', 'on', 'at', 'to',
  'is', 'are', 'be', 'this', 'that', 'it', 'as', 'by', 'from', 'used', 'new',
  'great', 'nice', 'good', 'excellent', 'condition', 'sale', 'selling',
]);

/** Tokenize a title into a normalized set of meaningful words. */
export function titleTokens(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    // Split letter-digit transitions so "DEWALT20V" → "dewalt 20v" — Amazon
    // listings routinely concatenate brand + voltage, otherwise the brand
    // token would never match against the original listing's "dewalt".
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return new Set(tokens);
}

/** Jaccard similarity over two token sets, in [0, 1]. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const t of a) if (b.has(t)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

/** Treat null prices as compatible with anything; otherwise allow ~15% drift. */
function pricesCompatible(p1: number | null, p2: number | null): boolean {
  if (p1 == null || p2 == null) return true;
  if (p1 === 0 && p2 === 0) return true;
  const max = Math.max(p1, p2);
  if (max === 0) return false;
  return Math.abs(p1 - p2) / max <= 0.15;
}

interface DedupOptions {
  /** Minimum Jaccard score on title tokens to consider two listings duplicates. Default 0.75. */
  similarityThreshold?: number;
}

/**
 * Group listings that look like the same item across sources.
 *
 * Two listings are merged when:
 *   - their title token sets have Jaccard similarity ≥ threshold, AND
 *   - their prices are within 15% of each other (or one is missing).
 *
 * Within a group, the "primary" listing is the one with the lowest non-null
 * price; ties broken by most recent postedAt, then by source order (cl > kijiji > fb).
 */
export function groupListings(listings: Listing[], opts: DedupOptions = {}): ListingGroup[] {
  const threshold = opts.similarityThreshold ?? 0.75;
  const tokenized = listings.map((l) => ({ listing: l, tokens: titleTokens(l.title) }));

  // Union-Find over listing indices.
  const parent = listings.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (x: number, y: number) => { const rx = find(x), ry = find(y); if (rx !== ry) parent[rx] = ry; };

  // Within-source duplicates first (same sourceId), then cross-source by similarity.
  const byKey = new Map<string, number>();
  for (let i = 0; i < tokenized.length; i++) {
    const k = `${tokenized[i].listing.source}::${tokenized[i].listing.sourceId}`;
    if (byKey.has(k)) union(byKey.get(k)!, i);
    else byKey.set(k, i);
  }

  for (let i = 0; i < tokenized.length; i++) {
    for (let j = i + 1; j < tokenized.length; j++) {
      const a = tokenized[i], b = tokenized[j];
      if (a.listing.source === b.listing.source && a.listing.sourceId === b.listing.sourceId) continue;
      if (!pricesCompatible(a.listing.price, b.listing.price)) continue;
      if (jaccard(a.tokens, b.tokens) >= threshold) union(i, j);
    }
  }

  const buckets = new Map<number, number[]>();
  for (let i = 0; i < listings.length; i++) {
    const r = find(i);
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r)!.push(i);
  }

  const groups: ListingGroup[] = [];
  for (const indices of buckets.values()) {
    const items = indices.map((i) => listings[i]);
    items.sort(comparePrimary);
    const sources = new Set(items.map((l) => l.source));
    groups.push({
      primary: items[0],
      duplicates: items.slice(1),
      sourceCount: sources.size,
    });
  }

  // Sort groups: more-source-coverage first (likely truly duplicated good deals),
  // then by primary price ascending.
  groups.sort((a, b) => {
    if (b.sourceCount !== a.sourceCount) return b.sourceCount - a.sourceCount;
    const pa = a.primary.price ?? Number.POSITIVE_INFINITY;
    const pb = b.primary.price ?? Number.POSITIVE_INFINITY;
    return pa - pb;
  });
  return groups;
}

function comparePrimary(a: Listing, b: Listing): number {
  // Lowest non-null price first; nulls sort last.
  const pa = a.price ?? Number.POSITIVE_INFINITY;
  const pb = b.price ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  // Most recent first.
  const ta = a.postedAt ? Date.parse(a.postedAt) : 0;
  const tb = b.postedAt ? Date.parse(b.postedAt) : 0;
  if (ta !== tb) return tb - ta;
  // Source order preference.
  const order: Record<string, number> = { craigslist: 0, kijiji: 1, facebook: 2 };
  return (order[a.source] ?? 99) - (order[b.source] ?? 99);
}
