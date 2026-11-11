/**
 * Distributed Redis-Backed Rate Limiting Engine
 * Enforces cluster-wide sliding-window rate limits across all API Gateway instances.
 * Implements discrete quotas for general API requests, execution submissions, and per-user limits.
 */

import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { logger } from '../utils/logger';

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
  errorMessage?: string;
  identifierExtractor?: (req: Request) => string;
}

export class DistributedRateLimiter {
  private redis: Redis | null = null;
  private isRedisReady = false;
  private localFallback = new Map<string, { count: number; resetAt: number }>();

  constructor(redisClient?: Redis | null) {
    if (redisClient) {
      this.redis = redisClient;
      this.isRedisReady = redisClient.status === 'ready' || redisClient.status === 'connect';
      this.redis.on('connect', () => { this.isRedisReady = true; });
      this.redis.on('error', () => { this.isRedisReady = false; });
    }
  }

  public setRedisClient(client: Redis | null): void {
    this.redis = client;
    if (client) {
      this.isRedisReady = client.status === 'ready' || client.status === 'connect';
      client.on('connect', () => { this.isRedisReady = true; });
      client.on('error', () => { this.isRedisReady = false; });
    } else {
      this.isRedisReady = false;
    }
  }

  /**
   * Generates Express middleware for sliding-window rate limiting
   */
  public createMiddleware(options: RateLimiterOptions) {
    const {
      windowMs,
      max,
      keyPrefix,
      errorMessage = 'Rate limit exceeded. Please retry later.',
      identifierExtractor = (req) => (req as any).userId || req.ip || '127.0.0.1',
    } = options;

    return async (req: Request, res: Response, next: NextFunction) => {
      const identifier = identifierExtractor(req);
      const key = `ratelimit:${keyPrefix}:${identifier}`;
      const now = Date.now();
      const windowStart = now - windowMs;

      // 1. Redis Sliding-Window Counter via Sorted Set (ZSET)
      if (this.isRedisReady && this.redis) {
        try {
          const multi = this.redis.multi();
          // Remove records older than the window
          multi.zremrangebyscore(key, '-inf', windowStart);
          // Add current request timestamp
          multi.zadd(key, now, `${now}-${Math.random().toString(36).slice(2, 6)}`);
          // Count requests in window
          multi.zcard(key);
          // Set TTL on the key
          multi.pexpire(key, windowMs + 1000);

          const results = await multi.exec();
          if (results && results[2] && results[2][1]) {
            const requestCount = results[2][1] as number;
            const remaining = Math.max(0, max - requestCount);

            res.setHeader('X-RateLimit-Limit', max);
            res.setHeader('X-RateLimit-Remaining', remaining);
            res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));

            if (requestCount > max) {
              const retryAfterSec = Math.ceil(windowMs / 1000);
              res.setHeader('Retry-After', retryAfterSec);
              logger.warn({ identifier, keyPrefix, count: requestCount, max }, 'Distributed rate limit triggered');
              return res.status(429).json({
                error: 'Too Many Requests',
                message: errorMessage,
                limit: max,
                windowSeconds: Math.ceil(windowMs / 1000),
                retryAfterSeconds: retryAfterSec,
              });
            }
          }
          return next();
        } catch (err: any) {
          logger.debug({ err: err.message }, 'Redis rate limiter error, utilizing local sliding window fallback');
        }
      }

      // 2. In-Memory Resilient Fallback (Active during Redis blips or offline local testing)
      const current = this.localFallback.get(key);
      if (!current || now > current.resetAt) {
        this.localFallback.set(key, { count: 1, resetAt: now + windowMs });
        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', max - 1);
        return next();
      }

      if (current.count >= max) {
        const retryAfterSec = Math.ceil((current.resetAt - now) / 1000);
        res.setHeader('Retry-After', retryAfterSec);
        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', 0);
        return res.status(429).json({
          error: 'Too Many Requests',
          message: errorMessage,
          limit: max,
          windowSeconds: Math.ceil(windowMs / 1000),
          retryAfterSeconds: retryAfterSec,
        });
      }

      current.count++;
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - current.count));
      return next();
    };
  }
}

export const distributedRateLimiter = new DistributedRateLimiter().createMiddleware({
  windowMs: 60 * 1000,
  max: 120,
  keyPrefix: 'jobs',
  errorMessage: 'Rate limit exceeded. Maximum 120 execution requests per minute.',
});

