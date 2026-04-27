import { AsyncSearchService } from './async-search.js';
import { searchListings } from './search.js';
import { MAX_CONCURRENT_TASKS } from './globals.js';

/**
 * Background worker: pulls tasks off the Redis queue and runs `searchListings`
 * for each. Per-source errors are already non-fatal inside the orchestrator
 * (each source is `Promise.allSettled`-wrapped), so the only error path here
 * is "the search itself threw" — which only happens on validation errors or
 * outright bugs. We don't retry here: source-level transients are already
 * surfaced to the client as part of the per-source status.
 */
export class AsyncSearchWorker {
  private service: AsyncSearchService;
  private isRunning = false;
  private activeTasks = new Set<Promise<void>>();
  private maxConcurrentTasks: number;

  constructor(redisUrl: string, keyPrefix: string) {
    this.service = new AsyncSearchService(redisUrl, keyPrefix);
    this.maxConcurrentTasks = MAX_CONCURRENT_TASKS;
  }

  start(): void {
    if (this.isRunning) {
      console.log('[worker] already running');
      return;
    }
    this.isRunning = true;
    console.log(`[worker] starting (max ${this.maxConcurrentTasks} concurrent tasks)`);
    this.processingLoop();
  }

  stop(): void {
    this.isRunning = false;
    console.log('[worker] stopping...');
  }

  private async processingLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        if (this.activeTasks.size < this.maxConcurrentTasks) {
          const taskId = await this.service.getNextPendingTask();
          if (taskId) {
            const p = this.processTask(taskId);
            this.activeTasks.add(p);
            p.finally(() => this.activeTasks.delete(p));
          } else {
            await sleep(1000);
          }
        } else {
          await Promise.race(this.activeTasks);
        }
      } catch (err) {
        console.error('[worker] error in processing loop:', err);
        await sleep(5000);
      }
    }

    if (this.activeTasks.size > 0) {
      console.log(`[worker] waiting for ${this.activeTasks.size} active tasks to drain...`);
      await Promise.allSettled(this.activeTasks);
    }
    await this.service.close();
    console.log('[worker] stopped');
  }

  private async processTask(taskId: string): Promise<void> {
    const startTime = Date.now();
    try {
      const task = await this.service.getTask(taskId);
      if (!task) {
        console.log(`[worker] task=${taskId} not found, skipping`);
        return;
      }
      if (task.status !== 'pending') {
        console.log(`[worker] task=${taskId} already in status=${task.status}, skipping`);
        return;
      }

      await this.service.updateTask(taskId, { status: 'running' });
      console.log(`[worker] task=${taskId} running, keywords="${task.options.keywords}" location="${task.options.location}"`);

      const result = await searchListings(task.options);
      const durationMs = Date.now() - startTime;
      console.log(`[worker] task=${taskId} status=completed groups=${result.groups.length} listings=${result.totalListings} duration_ms=${durationMs}`);
      await this.service.updateTask(taskId, { status: 'completed', result });
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[worker] task=${taskId} status=error duration_ms=${durationMs} error="${message}"`);
      try {
        await this.service.updateTask(taskId, { status: 'error', errorMessage: message });
      } catch (updateErr) {
        console.error(`[worker] task=${taskId} failed to record error state:`, updateErr);
      }
    }
  }

  async getStatus() {
    return {
      isRunning: this.isRunning,
      queueLength: await this.service.getQueueLength(),
      activeTasks: this.activeTasks.size,
      maxConcurrentTasks: this.maxConcurrentTasks,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
