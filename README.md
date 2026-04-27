# usedlocal

A [Turtle](https://github.com/longrun-ai/turtle) MCP server that searches local
used-goods marketplaces (Craigslist, Kijiji, Facebook Marketplace) for a given
keyword + location, groups duplicate listings across sources, and returns
publicly-shareable links to each one.

It's authenticated and metered through [ATXP](https://atxp.ai), so any MCP
client that supports ATXP can call it directly.

## What it does

- **One tool, `usedlocal_search`**: takes `keywords` + `location` (+ optional
  price filters and source list), returns a list of grouped listings.
- **Sources**:
  - **Craigslist** — primary, via the official `?format=rss` Atom feed. Most
    reliable; works in any city Craigslist serves.
  - **Kijiji** — best-effort HTML scrape against `kijiji.ca`. Works most of the
    time; surfaces a non-fatal error when Kijiji's Cloudflare layer challenges
    us. Canada-only.
  - **Facebook Marketplace** — disabled by default; FB Marketplace requires
    auth and runs behind anti-bot, so the source is a stub unless
    `FACEBOOK_APIFY_TOKEN` is set (in which case we proxy via the Apify
    `junglee/facebook-marketplace` actor).
- **Dedup**: titles are tokenized, stopwords stripped, and listings are merged
  when (Jaccard ≥ 0.6 AND prices within 15%) — across or within sources.
  Within a group, the lowest price becomes the "primary".

The shape of the response is documented in [`src/types.ts`](src/types.ts)
(`SearchResponse`).

## Local development

```bash
cp env.example .env
# fill in FUNDING_DESTINATION_ATXP at minimum
npm install
npm run dev      # MCP server on :3001
```

Or skip the MCP layer and exercise the search pipeline directly:

```bash
npm run cli -- search "ikea bekant desk" -l "Toronto"
npm run cli -- search "dewalt drill" -l sfbay --max 150 --json
```

## Tests

```bash
npm test
```

Tests cover the dedup logic and location-resolution table. The scrapers
themselves are not covered by the default suite (they hit the live network);
use `npm run cli` to smoke-test them.

## Deployment

The repo ships a [`render.yaml`](render.yaml) blueprint. To deploy a new
service from this repo on Render:

```bash
# After pushing to GitHub:
render services create --output json     # interactive: pick "Blueprint" & this repo
# Then set secrets in the Render dashboard:
#   FUNDING_DESTINATION_ATXP, NPM_TOKEN, (optional) OAUTH_DB_REDIS_URL, etc.
```

Or deploy by hand: `npm ci && npm run build`, then `npm run start`.

## Configuration

See [`env.example`](env.example) for the full list. The most important knobs:

| Env var | Default | Notes |
| --- | --- | --- |
| `FUNDING_DESTINATION_ATXP` | — | **Required.** ATXP funding destination URL. |
| `SEARCH_COST` | `0.02` | USD per search call. Set to `0` to disable charging. |
| `ENABLED_SOURCES` | `craigslist,kijiji` | Comma-separated. Add `facebook` if you've configured `FACEBOOK_APIFY_TOKEN`. |
| `MAX_RESULTS_PER_SOURCE` | `50` | Cap on raw listings per source before dedup. |
| `SOURCE_TIMEOUT_MS` | `15000` | Per-source HTTP timeout. |
| `OAUTH_DB_REDIS_URL` | — | Optional Redis URL for ATXP OAuth state. |

## Roadmap

- A CLI binary published to npm (`npx usedlocal …`).
- A web client that wraps this MCP server.
- More sources (OfferUp, eBay local, Gumtree).
- Image-hash-based dedup for stronger cross-source merging.
