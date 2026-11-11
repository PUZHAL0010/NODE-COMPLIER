/**
 * Real-Time Stream Broker Service
 * Dispatches stdout/stderr/metrics chunks over Redis PubSub to API SSE streaming clients.
 */

import EventEmitter from 'events';
import Redis from 'ioredis';
import { StreamChunk } from '../../shared/types';
import { logger } from '../utils/logger';

export class StreamService {
  private static instance: StreamService;
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private localEmitter = new EventEmitter();
  private isRedisConnected = false;
  private localBuffers = new Map<string, { chunks: StreamChunk[]; lastUpdated: number }>();
  private readonly MAX_CHUNKS_PER_JOB = 1000;

  private constructor() {
    this.localEmitter.setMaxListeners(1000);
    this.initRedis();

    // Periodic cleanup of stale in-memory buffers every 5 minutes
    setInterval(() => {
      const now = Date.now();
      const maxAgeMs = 15 * 60 * 1000; // 15 minutes
      for (const [jobId, item] of this.localBuffers.entries()) {
        if (now - item.lastUpdated > maxAgeMs) {
          this.localBuffers.delete(jobId);
        }
      }
    }, 5 * 60 * 1000).unref();
  }

  public static getInstance(): StreamService {
    if (!StreamService.instance) {
      StreamService.instance = new StreamService();
    }
    return StreamService.instance;
  }

  private initRedis(): void {
    const redisUrl = process.env.REDIS_URL;
    const redisConfig = redisUrl
      ? redisUrl
      : {
          host: process.env.REDIS_HOST || '127.0.0.1',
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
          password: process.env.REDIS_PASSWORD || undefined,
          db: parseInt(process.env.REDIS_DB || '0', 10),
          lazyConnect: true,
          retryStrategy: (times: number) => Math.min(times * 100, 3000),
        };

    try {
      this.publisher = new Redis(redisConfig as any);
      this.subscriber = new Redis(redisConfig as any);

      this.publisher.on('connect', () => {
        this.isRedisConnected = true;
        logger.info('StreamService: Redis Publisher connected');
      });

      this.publisher.on('error', (err) => {
        logger.warn({ err: err.message }, 'StreamService: Redis Publisher error; using local event emitter fallback');
        this.isRedisConnected = false;
      });

      this.subscriber.on('error', (err) => {
        logger.warn({ err: err.message }, 'StreamService: Redis Subscriber error; using local event emitter fallback');
        this.isRedisConnected = false;
      });

      // Try connecting lazily
      this.publisher.connect().catch(() => {});
      this.subscriber.connect().catch(() => {});
    } catch (err) {
      logger.warn({ err }, 'StreamService: Redis initialization failed; operating in local mode');
      this.isRedisConnected = false;
    }
  }

  /**
   * Publish a stream chunk to all subscribers for a given jobId and buffer it for replay.
   */
  public async publishChunk(jobId: string, chunk: StreamChunk): Promise<void> {
    const payload = JSON.stringify(chunk);

    // 1. Buffer in memory for fast local replay and fallback
    let jobBuf = this.localBuffers.get(jobId);
    if (!jobBuf) {
      jobBuf = { chunks: [], lastUpdated: Date.now() };
      this.localBuffers.set(jobId, jobBuf);
    }
    jobBuf.lastUpdated = Date.now();
    if (jobBuf.chunks.length < this.MAX_CHUNKS_PER_JOB) {
      jobBuf.chunks.push(chunk);
    }

    // 2. Always emit locally for in-process gateway subscribers
    this.localEmitter.emit(`stream:${jobId}`, chunk);

    // 3. Publish to Redis and append to Redis list buffer for distributed replay
    if (this.isRedisConnected && this.publisher && this.publisher.status === 'ready') {
      try {
        const bufferKey = `stream:buffer:${jobId}`;
        const pipeline = this.publisher.pipeline();
        pipeline.rpush(bufferKey, payload);
        pipeline.expire(bufferKey, 3600); // 1-hour TTL
        pipeline.publish(`stream:${jobId}`, payload);
        await pipeline.exec();
      } catch (err) {
        logger.debug({ jobId, err }, 'Failed to buffer/publish chunk in Redis');
      }
    }
  }

  /**
   * Fetch all buffered chunks for a job (used to replay execution history upon client reconnect)
   */
  public async getReplayChunks(jobId: string): Promise<StreamChunk[]> {
    if (this.isRedisConnected && this.publisher && this.publisher.status === 'ready') {
      try {
        const bufferKey = `stream:buffer:${jobId}`;
        const rawList = await this.publisher.lrange(bufferKey, 0, -1);
        if (rawList && rawList.length > 0) {
          const chunks: StreamChunk[] = [];
          for (const item of rawList) {
            try {
              chunks.push(JSON.parse(item));
            } catch {
              // skip corrupted item
            }
          }
          return chunks;
        }
      } catch (err) {
        logger.debug({ jobId, err }, 'Failed to fetch replay chunks from Redis, checking local buffer');
      }
    }

    const localEntry = this.localBuffers.get(jobId);
    return localEntry ? [...localEntry.chunks] : [];
  }

  /**
   * Subscribe to live execution events for a jobId
   */
  public subscribeToJob(jobId: string, callback: (chunk: StreamChunk) => void): () => void {
    const channel = `stream:${jobId}`;

    if (this.isRedisConnected && this.subscriber && this.subscriber.status === 'ready') {
      this.subscriber.subscribe(channel).catch(() => {});

      const redisMessageHandler = (subChannel: string, message: string) => {
        if (subChannel === channel) {
          try {
            const parsed = JSON.parse(message);
            callback(parsed);
          } catch {
            // Ignore malformed message
          }
        }
      };

      this.subscriber.on('message', redisMessageHandler);

      return () => {
        if (this.subscriber && this.subscriber.status === 'ready') {
          this.subscriber.unsubscribe(channel).catch(() => {});
          this.subscriber.off('message', redisMessageHandler);
        }
      };
    }

    const localHandler = (chunk: StreamChunk) => {
      callback(chunk);
    };

    this.localEmitter.on(channel, localHandler);

    return () => {
      this.localEmitter.off(channel, localHandler);
    };
  }

  public async close(): Promise<void> {
    if (this.publisher) {
      await this.publisher.quit().catch(() => {});
    }
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => {});
    }
    this.localEmitter.removeAllListeners();
    this.localBuffers.clear();
  }
}
