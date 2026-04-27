import { Redis } from 'ioredis';
import { randomUUID } from 'crypto';
import type { AsyncSearchTask, SearchOptions, SearchResponse, SourceName } from './types.js';

const TWELVE_HOURS_IN_SECONDS = 12 * 60 * 60;
const TASK_KEY_PREFIX = 'async-search-task:';
const QUEUE_KEY = 'async-search-queue';

/**
 * Redis-backed task queue + key/value store for async searches. Mirrors the
 * pattern in ../music-server: a list (`*-queue`) for FIFO worker pickup, and
 * a per-task key (`*-task:<id>`) holding the JSON payload with a 12-hour TTL.
 */
export class AsyncSearchService {
  private redis: Redis;
  private keyPrefix: string;

  constructor(redisUrl: string, keyPrefix: string) {
    this.redis = new Redis(redisUrl);
    this.keyPrefix = keyPrefix;
  }

  async createTask(
    accountId: string,
    options: SearchOptions,
    pricedSources: SourceName[],
    pricedAmountUsd: number,
  ): Promise<string> {
    const taskId = randomUUID();
    const task: AsyncSearchTask = {
      taskId,
      accountId,
      options,
      pricedSources,
      pricedAmountUsd,
      status: 'pending',
      createdAt: Date.now(),
    };

    const taskKey = `${this.keyPrefix}${TASK_KEY_PREFIX}${taskId}`;
    const queueKey = `${this.keyPrefix}${QUEUE_KEY}`;

    await this.redis.setex(taskKey, TWELVE_HOURS_IN_SECONDS, JSON.stringify(task));
    await this.redis.lpush(queueKey, taskId);

    return taskId;
  }

  async getTask(taskId: string): Promise<AsyncSearchTask | null> {
    const taskKey = `${this.keyPrefix}${TASK_KEY_PREFIX}${taskId}`;
    const data = await this.redis.get(taskKey);
    if (!data) return null;
    return JSON.parse(data) as AsyncSearchTask;
  }

  async updateTask(taskId: string, updates: Partial<AsyncSearchTask>): Promise<void> {
    const existing = await this.getTask(taskId);
    if (!existing) throw new Error(`Task ${taskId} not found`);
    const updated: AsyncSearchTask = { ...existing, ...updates };
    if (updates.status === 'completed' || updates.status === 'error') {
      updated.completedAt = Date.now();
    }
    const taskKey = `${this.keyPrefix}${TASK_KEY_PREFIX}${taskId}`;
    await this.redis.setex(taskKey, TWELVE_HOURS_IN_SECONDS, JSON.stringify(updated));
  }

  /** Block-pop the next pending task ID, or null if none arrives within 5s. */
  async getNextPendingTask(): Promise<string | null> {
    const queueKey = `${this.keyPrefix}${QUEUE_KEY}`;
    const result = await this.redis.brpop(queueKey, 5);
    return result ? result[1] : null;
  }

  async getQueueLength(): Promise<number> {
    return this.redis.llen(`${this.keyPrefix}${QUEUE_KEY}`);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
