// IMPORTANT: Observability init MUST be the first import
import '@longrun/observability/auto';
import 'dotenv/config';
import { OpenTelemetryObservability, LogLevel } from '@longrun/observability';
import { startHttpServer, getPostHogInstance } from '@longrun/turtle';
import { atxpExpress, ATXPArgs } from '@atxp/express';
import { UrlString, ATXPAccount } from '@atxp/common';
import { RedisOAuthDb } from '@atxp/redis';
import { BigNumber } from 'bignumber.js';
import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { searchAsyncTool, getAsyncTool, setAsyncSearchService } from './tools.js';
import { AsyncSearchService } from './async-search.js';
import { AsyncSearchWorker } from './worker.js';
import { FUNDING_DESTINATION_ATXP } from './globals.js';

const logger = new OpenTelemetryObservability(
  process.env.LOG_LEVEL?.toLowerCase() === 'debug' ? LogLevel.DEBUG : LogLevel.INFO
);

function getAuthToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const [type, token] = authHeader.split(' ');
    if (type === 'Bearer' && token) return token;
  }
  const xApiKey = req.headers['x-api-key'];
  if (xApiKey && typeof xApiKey === 'string') return xApiKey;
  return undefined;
}

let worker: AsyncSearchWorker | null = null;

export function run(port: number) {
  const posthog = getPostHogInstance();
  console.log(posthog ? 'PostHog analytics enabled' : 'PostHog analytics disabled (POSTHOG_API_KEY not set)');

  // Async-only deployment: Redis is required for the task queue.
  const redisUrl = process.env.OAUTH_DB_REDIS_URL;
  if (!redisUrl) {
    throw new Error('OAUTH_DB_REDIS_URL is required (used for both ATXP OAuth state and the async search task queue)');
  }

  const oAuthDb = new RedisOAuthDb({
    redis: redisUrl,
    keyPrefix: `atxp:oauth:${process.env.APP_NAME || 'usedlocal'}:${process.env.NODE_ENV || 'development'}:`,
  });

  const taskKeyPrefix = `atxp:async-search:${process.env.APP_NAME || 'usedlocal'}:${process.env.NODE_ENV || 'development'}:`;
  const asyncSearchService = new AsyncSearchService(redisUrl, taskKeyPrefix);
  setAsyncSearchService(asyncSearchService);

  worker = new AsyncSearchWorker(redisUrl, taskKeyPrefix);
  worker.start();

  const serverArgs: ATXPArgs = {
    destination: new ATXPAccount(FUNDING_DESTINATION_ATXP!),
    payeeName: 'UsedLocal',
    oAuthDb,
    logger,
  };
  if (process.env.MINIMUM_PAYMENT) {
    serverArgs.minimumPayment = new BigNumber(process.env.MINIMUM_PAYMENT);
  }
  if (process.env.AUTHORIZATION_SERVER_URL) {
    serverArgs.server = process.env.AUTHORIZATION_SERVER_URL as UrlString;
  }

  const skipWellKnown = (req: Request) => req.path.startsWith('/.well-known/');

  function logOnLimit(limiterName: string, message: object) {
    return (req: Request, res: Response, _next: NextFunction, _options: any) => {
      const token = getAuthToken(req);
      const tokenSuffix = token ? `...${token.slice(-8)}` : 'none';
      console.warn(`[rate-limit] 429 from ${limiterName} | ip=${req.ip} token=${tokenSuffix} path=${req.path} method=${req.method}`);
      res.status(429).json(message);
    };
  }

  const ipLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10000,
    skip: skipWellKnown,
    handler: logOnLimit('ip', { error: 'too_many_requests', error_description: 'Too many requests from this IP, please try again later.' }),
    keyGenerator: (req: Request) => req.ip || 'unknown',
    standardHeaders: false,
    legacyHeaders: false,
  });

  const clientLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    skip: skipWellKnown,
    handler: logOnLimit('client', { error: 'too_many_requests', error_description: 'Too many requests, please try again later.' }),
    keyGenerator: (req: Request) => getAuthToken(req) || req.ip || 'unknown',
    standardHeaders: true,
    legacyHeaders: false,
  });

  startHttpServer(
    port,
    [{
      tools: [searchAsyncTool, getAsyncTool],
      name: 'usedlocal',
      version: process.env.npm_package_version || '0.1.0',
      mountpath: '/',
      supportSSE: false,
      rateLimitConfig: { limit: 100000 },
    }],
    [ipLimiter, clientLimiter, atxpExpress(serverArgs)]
  );

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down`);
    if (worker) worker.stop();
    setTimeout(() => process.exit(0), 1000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3001;
  run(port);
}
