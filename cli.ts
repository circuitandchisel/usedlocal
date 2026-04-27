#!/usr/bin/env node
/**
 * usedlocal CLI — exercises the search pipeline directly without going through
 * the MCP server. Useful for testing scrapers + dedup locally.
 */
import { Command } from 'commander';
import { config } from 'dotenv';

config();

// Suppress the FUNDING_DESTINATION_ATXP guard for CLI use; we never invoke ATXP from here.
if (!process.env.FUNDING_DESTINATION_ATXP) {
  process.env.FUNDING_DESTINATION_ATXP = 'cli-noop';
}

const program = new Command();
program
  .name('usedlocal')
  .description('Search local used-goods marketplaces from the CLI')
  .version('0.1.0');

program
  .command('search')
  .argument('<keywords...>', 'keywords to search for')
  .requiredOption('-l, --location <location>', 'city / Craigslist subdomain (e.g. "Toronto", "sfbay")')
  .option('--min <n>', 'minimum price', (v) => parseInt(v, 10))
  .option('--max <n>', 'maximum price', (v) => parseInt(v, 10))
  .option('-s, --sources <list>', 'comma-separated source list (craigslist,kijiji,facebook)')
  .option('--json', 'emit raw JSON instead of a human summary')
  .action(async (keywords: string[], opts: any) => {
    const { searchListings } = await import('./src/search.js');
    const result = await searchListings({
      keywords: keywords.join(' '),
      location: opts.location,
      minPrice: opts.min,
      maxPrice: opts.max,
      sources: opts.sources ? opts.sources.split(',').map((s: string) => s.trim()) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`\nQuery: "${result.query.keywords}" near ${result.query.location}`);
    console.log(`Sources:`);
    for (const s of result.sources) {
      const tag = s.ok ? `${s.count} listings` : `ERROR: ${s.error}`;
      console.log(`  - ${s.name}: ${tag}`);
    }
    console.log(`\nGroups: ${result.groups.length} (from ${result.totalListings} raw listings)\n`);
    for (const g of result.groups.slice(0, 25)) {
      const price = g.primary.price != null ? `$${g.primary.price}` : '—';
      const tag = g.duplicates.length > 0 ? ` [+${g.duplicates.length} dupes across ${g.sourceCount} sources]` : '';
      console.log(`${price.padEnd(8)} ${g.primary.title}${tag}`);
      console.log(`         ${g.primary.url}`);
      for (const d of g.duplicates) console.log(`         ↳ ${d.source}: ${d.url}`);
    }
  });

program.parseAsync().catch((e) => {
  console.error('Error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
