# usedlocal

A [Turtle](https://github.com/longrun-ai/turtle) MCP server that searches local
used-goods marketplaces (Craigslist, Kijiji, Facebook Marketplace) for a given
keyword + location, groups duplicate listings across sources, and returns
publicly-shareable links to each one.

It's authenticated and metered through [ATXP](https://atxp.ai), so any MCP
client that supports ATXP can call it directly.

## Tools

The server exposes **two** tools, modelled on the async pattern from the
sibling `music-server`:

- **`usedlocal_search_async`** — start a search.

  Takes `keywords`, `location`, optional `minPrice` / `maxPrice`,
  optional `sources` array (subset of `craigslist`, `kijiji`, `facebook`),
  and optional `maxPerSource`. Charges the caller via ATXP based on the
  *requested* sources (see [Pricing](#pricing) below) and returns a
  `taskId`.

- **`usedlocal_get_async`** — poll for the result.

  Takes `taskId`, returns `{ status, result?, errorMessage? }` where
  `status ∈ {pending, running, completed, error}`. When `completed`, the
  full grouped response is on `result`.

The shape of the completed result is documented in
[`src/types.ts`](src/types.ts) (`SearchResponse`).

## Sources

- **Craigslist** — primary, scrapes the SSR HTML fallback (the JS-app's
  static-search markup). Reliable, cheap. Their `?format=rss` feed was
  retired in 2024.
- **Kijiji** — best-effort: HTML fetch + parse of the embedded `__NEXT_DATA__`
  blob. Surfaces a non-fatal error when Cloudflare challenges. Canada-only.
- **Facebook Marketplace** — disabled by default. Requires
  `FACEBOOK_APIFY_TOKEN` (proxies via the Apify FB Marketplace actor) since
  the site itself requires authentication and runs strong anti-bot.

The `ListingSource` interface in [`src/types.ts`](src/types.ts) is the
extension point. Switching Kijiji or Facebook to a paid scrape backend
(ScraperAPI, Playwright + residential proxies, a different Apify actor)
is a single-file change; the orchestrator + dedup don't care.

## Dedup

Titles are tokenized (lowercased, punctuation stripped, stopwords removed)
and listings are merged when their token sets have **Jaccard similarity ≥
0.75 AND prices within 15%** of each other (or one is missing). Within a
group, the lowest non-null price becomes the "primary"; the rest are
exposed as `duplicates`.

Groups are returned sorted by source-coverage (more sources first → likely
genuine cross-listed items) then by primary price ascending.

## Pricing

The customer-facing price for a search is derived dynamically from the
*sources actually requested*:

```
price = max(sum(source_costs) * PRICING_MARGIN_MULTIPLIER, PRICING_MINIMUM_PRICE)
```

Per-source costs are env-configurable so that swapping a source's backend
(direct HTTP → Apify → Playwright + proxy) widens the ATXP charge
automatically:

| Source | Default cost (USD) | Reflects |
| --- | ---: | --- |
| `craigslist` | `$0.001` | Direct HTTP fetch, effectively free. |
| `kijiji` | `$0.05` | Budget for a paid scrape backend. |
| `facebook` | `$0.20` | Budget for an Apify FB Marketplace actor run. |

Defaults: `PRICING_MARGIN_MULTIPLIER=1.25`, `PRICING_MINIMUM_PRICE=$0.02`.

So a default `craigslist + kijiji` search charges ≈ `$0.064`; adding
`facebook` brings it to ≈ `$0.314`. Override any of these via the env vars
in [`env.example`](env.example).

## Local development

```bash
cp env.example .env
# fill in FUNDING_DESTINATION_ATXP and OAUTH_DB_REDIS_URL
npm install
npm run dev      # MCP server on :3001 + background worker
```

You can also exercise the search pipeline directly without ATXP, the queue,
or Redis — useful for testing scrapers + dedup:

```bash
npm run cli -- search "ikea bekant desk" -l Toronto
npm run cli -- search "dewalt drill" -l sfbay --max 150 --json
```

## Tests

```bash
npm test
```

Unit tests cover the dedup logic, location-resolution table, and pricing
math. The scrapers themselves hit the live network, so they're exercised
via `npm run cli`, not the default suite.

## Deployment

The repo ships a [`render.yaml`](render.yaml) blueprint. You'll need a
Redis instance (Render Key-Value or external) and to set
`OAUTH_DB_REDIS_URL` and `FUNDING_DESTINATION_ATXP` as env secrets in the
Render dashboard.

## Roadmap

- A CLI binary published to npm (`npx usedlocal …`).
- A web client that wraps this MCP server.
- Switch Kijiji + Facebook to a paid backend (Apify or ScraperAPI proxy)
  with retries; the pricing model already covers the cost.
- More sources (OfferUp, eBay local, Gumtree, Vinted).
- Image-hash-based dedup for stronger cross-source merging.
