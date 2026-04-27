/**
 * Resolve a free-text location string into source-specific identifiers.
 *
 * Craigslist uses subdomains (e.g. "sfbay", "newyork", "toronto"). We accept
 * either the subdomain directly ("sfbay") or a city name we recognise.
 *
 * Kijiji uses numeric region IDs ("l1700273" = Toronto). The mapping is
 * coarse — we cover major Canadian metros and fall back to the all-Canada
 * search when we don't recognise the city.
 */

interface ResolvedLocation {
  raw: string;
  /** Craigslist subdomain, e.g. "sfbay". null if Craigslist doesn't serve this area. */
  craigslistSubdomain: string | null;
  /** Kijiji region ID, e.g. "1700273" (Toronto). null = use all-of-Canada. */
  kijijiRegionId: string | null;
  /** Kijiji city slug for URL building, e.g. "city-of-toronto". null = "canada". */
  kijijiCitySlug: string | null;
}

const CRAIGSLIST_SUBDOMAINS: Record<string, string> = {
  'sfbay': 'sfbay',
  'san francisco': 'sfbay',
  'san francisco bay area': 'sfbay',
  'sf bay area': 'sfbay',
  'oakland': 'sfbay',
  'berkeley': 'sfbay',
  'new york': 'newyork',
  'nyc': 'newyork',
  'manhattan': 'newyork',
  'brooklyn': 'newyork',
  'los angeles': 'losangeles',
  'la': 'losangeles',
  'chicago': 'chicago',
  'seattle': 'seattle',
  'portland': 'portland',
  'boston': 'boston',
  'austin': 'austin',
  'denver': 'denver',
  'atlanta': 'atlanta',
  'washington dc': 'washingtondc',
  'dc': 'washingtondc',
  'philadelphia': 'philadelphia',
  'philly': 'philadelphia',
  'san diego': 'sandiego',
  'phoenix': 'phoenix',
  'miami': 'miami',
  'dallas': 'dallas',
  'houston': 'houston',
  'minneapolis': 'minneapolis',
  'detroit': 'detroit',
  'toronto': 'toronto',
  'vancouver': 'vancouver',
  'montreal': 'montreal',
  'calgary': 'calgary',
  'ottawa': 'ottawa',
  'london uk': 'london',
  'london': 'london',
  'paris': 'paris',
  'berlin': 'berlin',
};

const KIJIJI_REGIONS: Record<string, { id: string; slug: string }> = {
  'toronto': { id: '1700273', slug: 'city-of-toronto' },
  'gta': { id: '1700272', slug: 'gta-greater-toronto-area' },
  'vancouver': { id: '1700287', slug: 'city-of-vancouver' },
  'calgary': { id: '1700199', slug: 'city-of-calgary' },
  'edmonton': { id: '1700203', slug: 'edmonton' },
  'ottawa': { id: '1700185', slug: 'ottawa' },
  'montreal': { id: '1700281', slug: 'ville-de-montreal' },
  'winnipeg': { id: '1700192', slug: 'city-of-winnipeg' },
  'halifax': { id: '1700321', slug: 'city-of-halifax' },
  'quebec city': { id: '1700124', slug: 'ville-de-quebec' },
  'hamilton': { id: '1700213', slug: 'hamilton' },
  'kitchener': { id: '1700212', slug: 'kitchener-area' },
  'london': { id: '1700214', slug: 'london' },
  'victoria': { id: '1700173', slug: 'victoria-bc' },
};

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function resolveLocation(raw: string): ResolvedLocation {
  const norm = normalize(raw);

  // 1. Direct subdomain match (e.g. "sfbay") — single token, no spaces, lowercase.
  let craigslistSubdomain: string | null = null;
  if (/^[a-z]{2,20}$/.test(norm) && Object.values(CRAIGSLIST_SUBDOMAINS).includes(norm)) {
    craigslistSubdomain = norm;
  }

  // 2. City lookups. Try the full string, then the first segment (before comma/state).
  if (!craigslistSubdomain) {
    if (CRAIGSLIST_SUBDOMAINS[norm]) {
      craigslistSubdomain = CRAIGSLIST_SUBDOMAINS[norm];
    } else {
      const firstSegment = norm.split(' ')[0];
      // Try progressively shorter prefixes ("san francisco bay area" -> "san francisco" -> "san").
      const tokens = norm.split(' ');
      for (let n = tokens.length; n >= 1 && !craigslistSubdomain; n--) {
        const prefix = tokens.slice(0, n).join(' ');
        if (CRAIGSLIST_SUBDOMAINS[prefix]) {
          craigslistSubdomain = CRAIGSLIST_SUBDOMAINS[prefix];
        }
      }
      // Last attempt: just the first token alone.
      if (!craigslistSubdomain && CRAIGSLIST_SUBDOMAINS[firstSegment]) {
        craigslistSubdomain = CRAIGSLIST_SUBDOMAINS[firstSegment];
      }
    }
  }

  // Kijiji: same prefix-strategy lookup.
  let kijijiRegion: { id: string; slug: string } | null = null;
  if (KIJIJI_REGIONS[norm]) {
    kijijiRegion = KIJIJI_REGIONS[norm];
  } else {
    const tokens = norm.split(' ');
    for (let n = tokens.length; n >= 1 && !kijijiRegion; n--) {
      const prefix = tokens.slice(0, n).join(' ');
      if (KIJIJI_REGIONS[prefix]) kijijiRegion = KIJIJI_REGIONS[prefix];
    }
  }

  return {
    raw,
    craigslistSubdomain,
    kijijiRegionId: kijijiRegion?.id ?? null,
    kijijiCitySlug: kijijiRegion?.slug ?? null,
  };
}
