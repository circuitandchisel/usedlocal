#!/usr/bin/env node
/**
 * usedlocal CLI — exercises the search pipeline directly without going through
 * the MCP server. Two modes:
 *
 *   `usedlocal search ...`           — calls the searchListings orchestrator
 *                                      synchronously (no Redis, no ATXP).
 *
 *   `usedlocal search ... --async`   — boots an in-process AsyncSearchWorker,
 *                                      enqueues a task, polls until done.
 *                                      Requires OAUTH_DB_REDIS_URL. Useful for
 *                                      end-to-end testing of the worker +
 *                                      task service without an ATXP token.
 */
import { Command } from 'commander';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';

config();

if (!process.env.FUNDING_DESTINATION_ATXP) {
  process.env.FUNDING_DESTINATION_ATXP = 'cli-noop';
}

const program = new Command();
program.name('usedlocal').description('Search local used-goods marketplaces from the CLI').version('0.1.0');

program
  .command('search')
  .argument('<keywords...>', 'keywords to search for')
  .requiredOption('-l, --location <location>', 'city / Craigslist subdomain (e.g. "Toronto", "sfbay")')
  .option('--min <n>', 'minimum price', (v) => parseInt(v, 10))
  .option('--max <n>', 'maximum price', (v) => parseInt(v, 10))
  .option('-s, --sources <list>', 'comma-separated source list (craigslist,kijiji,facebook)')
  .option('--json', 'emit raw JSON instead of a human summary')
  .option('--async', 'run through the Redis-backed task queue + worker (requires OAUTH_DB_REDIS_URL)')
  .action(async (keywords: string[], opts: any) => {
    const searchOptions = {
      keywords: keywords.join(' '),
      location: opts.location,
      minPrice: opts.min,
      maxPrice: opts.max,
      sources: opts.sources ? opts.sources.split(',').map((s: string) => s.trim()) : undefined,
    };

    if (opts.async) {
      await runAsync(searchOptions, opts.json);
    } else {
      const { searchListings } = await import('./src/search.js');
      const result = await searchListings(searchOptions as any);
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else printResult(result);
    }
  });

async function runAsync(searchOptions: any, asJson: boolean) {
  const redisUrl = process.env.OAUTH_DB_REDIS_URL;
  if (!redisUrl) {
    console.error('--async requires OAUTH_DB_REDIS_URL to be set (e.g. redis://localhost:6379)');
    process.exit(1);
  }

  const { AsyncSearchService } = await import('./src/async-search.js');
  const { AsyncSearchWorker } = await import('./src/worker.js');
  const { calculateSearchPrice } = await import('./src/pricing.js');
  const { ENABLED_SOURCES } = await import('./src/globals.js');

  const keyPrefix = `cli-test:${randomUUID().slice(0, 8)}:`;
  const service = new AsyncSearchService(redisUrl, keyPrefix);
  const worker = new AsyncSearchWorker(redisUrl, keyPrefix);
  worker.start();

  try {
    const sources = searchOptions.sources?.length ? searchOptions.sources : ENABLED_SOURCES;
    const price = calculateSearchPrice(sources);
    console.log(`[cli-async] enqueueing task; would charge $${price.toFixed(4)} via ATXP for sources [${sources.join(',')}]`);

    const taskId = await service.createTask('cli-test-account', searchOptions, sources, price);
    console.log(`[cli-async] taskId=${taskId}`);

    const start = Date.now();
    const timeoutMs = 180_000;
    while (Date.now() - start < timeoutMs) {
      await sleep(1000);
      const task = await service.getTask(taskId);
      if (!task) {
        console.error(`[cli-async] task ${taskId} disappeared`);
        break;
      }
      process.stdout.write(`\r[cli-async] status=${task.status} elapsed=${((Date.now() - start) / 1000).toFixed(1)}s   `);
      if (task.status === 'completed') {
        process.stdout.write('\n');
        if (asJson) console.log(JSON.stringify(task.result, null, 2));
        else if (task.result) printResult(task.result);
        return;
      }
      if (task.status === 'error') {
        process.stdout.write('\n');
        console.error(`[cli-async] task failed: ${task.errorMessage}`);
        process.exitCode = 1;
        return;
      }
    }
    console.error('\n[cli-async] timed out waiting for completion');
    process.exitCode = 1;
  } finally {
    worker.stop();
    await sleep(500);
    await service.close().catch(() => {});
  }
}

function printResult(result: any) {
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
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

program.parseAsync().catch((e) => {
  console.error('Error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
