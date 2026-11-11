/**
 * Job Queue & Lifecycle Service
 * Interfaces with BullMQ and Redis for fair job scheduling, cancellation, and status tracking.
 */

import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { nanoid } from 'nanoid';
import {
  ExecutionJob,
  ExecutionRequest,
  ExecutionResult,
  JobStatus,
  QueueMetrics,
} from '../../shared/types';
import { resolveExecutionLimits, SYSTEM_LIMITS } from '../utils/limits';
import { logger } from '../utils/logger';
import { ExecutionProcessor } from '../processor';

const QUEUE_NAME = process.env.QUEUE_NAME || 'node-execution';

export class JobService {
  private static instance: JobService;
  private queue: Queue | null = null;
  private queueEvents: QueueEvents | null = null;
  private redisClient: Redis | null = null;
  private isRedisAvailable = false;
  private fallbackJobStore = new Map<string, { job: ExecutionJob; status: JobStatus; result?: ExecutionResult }>();
  private localProcessor: ExecutionProcessor | null = null;
  private activeUserJobs = new Map<string, number>();
  private activeProjectJobs = new Map<string, number>();

  private activeLocalJobs = 0;
  private readonly maxLocalConcurrency = parseInt(process.env.MAX_LOCAL_CONCURRENCY || '32', 10);
  private localExecutionQueue: ExecutionJob[] = [];

  private constructor() {
    this.initQueue();
    // Periodic memory cleanup every 5 minutes
    setInterval(() => this.pruneStaleJobs(), 5 * 60 * 1000).unref();
  }

  public static getInstance(): JobService {
    if (!JobService.instance) {
      JobService.instance = new JobService();
    }
    return JobService.instance;
  }

  private pruneStaleJobs(): void {
    const now = Date.now();
    const maxAgeMs = 10 * 60 * 1000; // 10 minutes
    for (const [id, record] of this.fallbackJobStore.entries()) {
      if (record.status !== JobStatus.RUNNING && record.status !== JobStatus.QUEUED) {
        if (record.job.enqueuedAt && now - record.job.enqueuedAt > maxAgeMs) {
          this.fallbackJobStore.delete(id);
        }
      }
    }
    // Prevent unbounded memory growth if more than 3000 items
    if (this.fallbackJobStore.size > 3000) {
      const keys = Array.from(this.fallbackJobStore.keys());
      const toDelete = keys.slice(0, keys.length - 1500);
      for (const k of toDelete) {
        this.fallbackJobStore.delete(k);
      }
    }
  }

  private initQueue(): void {
    const redisConfig = {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      maxRetriesPerRequest: null,
      lazyConnect: true,
    };

    try {
      this.redisClient = new Redis(redisConfig as any);
      this.redisClient.on('connect', () => {
        this.isRedisAvailable = true;
        logger.info('JobService: Redis connection established');
      });
      this.redisClient.on('error', (err) => {
        logger.warn({ err: err.message }, 'JobService: Redis connection error; operating with local async execution');
        this.isRedisAvailable = false;
      });

      this.redisClient.connect().then(() => {
        this.queue = new Queue(QUEUE_NAME, {
          connection: this.redisClient as any,
          skipVersionCheck: true,
        });
        this.queueEvents = new QueueEvents(QUEUE_NAME, {
          connection: this.redisClient as any,
          skipVersionCheck: true,
        });
      }).catch(() => {
        this.isRedisAvailable = false;
      });
    } catch (err) {
      logger.warn({ err }, 'JobService: Queue initialization fallback to in-memory async runner');
      this.isRedisAvailable = false;
    }
  }

  /**
   * Submit an execution job to the distributed queue or local fallback processor
   */
  public async submitJob(
    request: ExecutionRequest,
    userId = 'anonymous-user',
    traceId?: string
  ): Promise<{ jobId: string; status: JobStatus }> {
    this.pruneStaleJobs();

    // Check if there are active jobs for this project that need cancellation or cleanup
    for (const [existingId, record] of this.fallbackJobStore.entries()) {
      if (record.job.projectId === request.projectId && (record.status === JobStatus.QUEUED || record.status === JobStatus.RUNNING)) {
        await this.cancelJob(existingId).catch(() => {});
      }
    }

    if (this.isRedisAvailable && this.redisClient) {
      try {
        await this.redisClient.publish('job:cancel', JSON.stringify({ projectId: request.projectId }));
      } catch {}
    }

    const currentForUser = this.activeUserJobs.get(userId) || 0;
    if (currentForUser >= SYSTEM_LIMITS.RATE_LIMIT_MAX_CONCURRENT_PER_USER) {
      this.activeUserJobs.set(userId, Math.max(0, currentForUser - 1));
    }

    const jobId = `job-${nanoid(12)}`;
    const limits = resolveExecutionLimits(request.options);

    const job: ExecutionJob = {
      ...request,
      jobId,
      userId,
      traceId: traceId || jobId,
      enqueuedAt: Date.now(),
      limits,
    };

    // Track active jobs
    this.activeUserJobs.set(userId, (this.activeUserJobs.get(userId) || 0) + 1);
    this.activeProjectJobs.set(request.projectId, 1);

    this.fallbackJobStore.set(jobId, { job, status: JobStatus.QUEUED });

    // Store distributed metadata in Redis hash if available
    if (this.isRedisAvailable && this.redisClient) {
      try {
        const metaKey = `job:meta:${jobId}`;
        await this.redisClient.hset(metaKey, {
          jobId,
          userId,
          projectId: request.projectId,
          status: JobStatus.QUEUED,
          enqueuedAt: job.enqueuedAt.toString(),
          entryFile: job.entryFile,
        });
        await this.redisClient.expire(metaKey, 7200); // 2-hour TTL
      } catch (err) {
        logger.debug({ jobId, err }, 'Failed to write initial job metadata to Redis');
      }
    }

    // In standalone distributed worker mode, delegate to BullMQ queue
    if (process.env.WORKER_STANDALONE === 'true' && this.isRedisAvailable && this.queue) {
      try {
        await this.queue.add('execute-node', job, {
          jobId,
          attempts: 1, // Do NOT retry deterministic user errors
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: { age: 3600, count: 5000 },
          removeOnFail: { age: 7200, count: 5000 },
        });
        return { jobId, status: JobStatus.QUEUED };
      } catch (queueErr) {
        logger.warn({ err: queueErr }, 'Queue submission failed, falling back to in-process execution');
      }
    }

    // Default fast in-process asynchronous dispatch (instant < 30ms execution in npm run dev)
    this.dispatchLocalJobAsync(job);
    return { jobId, status: JobStatus.QUEUED };
  }

  /**
   * Retrieve current job status or final result
   */
  public async getJob(jobId: string): Promise<{ status: JobStatus; result?: ExecutionResult } | null> {
    const record = this.fallbackJobStore.get(jobId);
    if (record) {
      return {
        status: record.status,
        result: record.result,
      };
    }

    // Check distributed Redis metadata hash
    if (this.isRedisAvailable && this.redisClient) {
      try {
        const meta = await this.redisClient.hgetall(`job:meta:${jobId}`);
        if (meta && meta.status) {
          let result: ExecutionResult | undefined = undefined;
          if (meta.result) {
            try {
              result = JSON.parse(meta.result);
            } catch {}
          }
          return {
            status: meta.status as JobStatus,
            result,
          };
        }
      } catch (err) {
        logger.debug({ jobId, err }, 'Failed to query job metadata from Redis');
      }
    }

    // Check BullMQ queue state
    if (this.isRedisAvailable && this.queue) {
      try {
        const bullJob = await this.queue.getJob(jobId);
        if (bullJob) {
          const state = await bullJob.getState();
          const mappedStatus = this.mapBullStateToJobStatus(state);
          return {
            status: mappedStatus,
            result: bullJob.returnvalue as ExecutionResult | undefined,
          };
        }
      } catch {}
    }

    return null;
  }

  /**
   * Idempotently cancel an active or queued job
   */
  public async cancelJob(jobId: string): Promise<{ success: boolean; message: string }> {
    await ExecutionProcessor.cancelJob(jobId);

    const record = this.fallbackJobStore.get(jobId);

    if (record) {
      record.status = JobStatus.CANCELLED;
      this.decrementActiveCounters(record.job.userId, record.job.projectId);
    }

    if (this.isRedisAvailable && this.queue) {
      try {
        const bullJob = await this.queue.getJob(jobId);
        if (bullJob) {
          const state = await bullJob.getState();
          if (state === 'waiting' || state === 'delayed') {
            await bullJob.remove();
          }
        }
      } catch (err) {
        logger.debug({ jobId, err }, 'Failed to remove job from BullMQ on cancel');
      }
    }

    if (this.isRedisAvailable && this.redisClient) {
      try {
        await this.redisClient.hset(`job:meta:${jobId}`, 'status', JobStatus.CANCELLED);
        if (record) {
          await this.redisClient.srem(`user:active_jobs:${record.job.userId}`, jobId);
        }
        await this.redisClient.publish('job:cancel', JSON.stringify({ jobId }));
      } catch (err) {
        logger.debug({ jobId, err }, 'Failed to publish job:cancel or update Redis');
      }
    }

    return { success: true, message: `Job ${jobId} cancellation requested.` };
  }

  /**
   * Get queue health and capacity metrics
   */
  public async getQueueMetrics(): Promise<QueueMetrics> {
    if (this.isRedisAvailable && this.queue) {
      const counts = await this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
      return {
        waitingCount: counts.waiting,
        activeCount: counts.active,
        completedCount: counts.completed,
        failedCount: counts.failed,
        delayedCount: counts.delayed,
        workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || '8', 10),
        totalThroughputPerMin: 0,
      };
    }

    let waiting = 0;
    let active = 0;
    let completed = 0;
    let failed = 0;

    for (const item of this.fallbackJobStore.values()) {
      if (item.status === JobStatus.QUEUED) waiting++;
      else if (item.status === JobStatus.RUNNING) active++;
      else if (item.status === JobStatus.SUCCESS) completed++;
      else failed++;
    }

    return {
      waitingCount: waiting,
      activeCount: active,
      completedCount: completed,
      failedCount: failed,
      delayedCount: 0,
      workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || '8', 10),
      totalThroughputPerMin: 0,
    };
  }

  private dispatchLocalJobAsync(job: ExecutionJob): void {
    if (this.activeLocalJobs >= this.maxLocalConcurrency) {
      this.localExecutionQueue.push(job);
      return;
    }

    this.activeLocalJobs++;

    setImmediate(async () => {
      if (!this.localProcessor) {
        this.localProcessor = new ExecutionProcessor();
      }

      job.startedAt = Date.now();
      const record = this.fallbackJobStore.get(job.jobId);
      if (record) {
        record.status = JobStatus.RUNNING;
      }

      if (this.isRedisAvailable && this.redisClient) {
        this.redisClient.hset(`job:meta:${job.jobId}`, 'status', JobStatus.RUNNING, 'startedAt', job.startedAt.toString()).catch(() => {});
        this.redisClient.sadd(`user:active_jobs:${job.userId}`, job.jobId).catch(() => {});
      }

      try {
        const result = await this.localProcessor.processJob(job);
        if (record) {
          record.status = result.status;
          record.result = result;
        }
        if (this.isRedisAvailable && this.redisClient) {
          this.redisClient.hset(`job:meta:${job.jobId}`, 'status', result.status, 'result', JSON.stringify(result)).catch(() => {});
        }
      } catch (err: unknown) {
        logger.error({ jobId: job.jobId, err }, 'Error in local fallback execution');
        if (record) {
          record.status = JobStatus.SYSTEM_ERROR;
        }
        if (this.isRedisAvailable && this.redisClient) {
          this.redisClient.hset(`job:meta:${job.jobId}`, 'status', JobStatus.SYSTEM_ERROR).catch(() => {});
        }
      } finally {
        this.activeLocalJobs--;
        this.decrementActiveCounters(job.userId, job.projectId);

        if (this.isRedisAvailable && this.redisClient) {
          this.redisClient.srem(`user:active_jobs:${job.userId}`, job.jobId).catch(() => {});
        }

        // Process next queued job if any
        if (this.localExecutionQueue.length > 0) {
          const nextJob = this.localExecutionQueue.shift();
          if (nextJob) {
            this.dispatchLocalJobAsync(nextJob);
          }
        }
      }
    });
  }

  private decrementActiveCounters(userId: string, projectId: string): void {
    const userCount = this.activeUserJobs.get(userId) || 0;
    if (userCount > 1) {
      this.activeUserJobs.set(userId, userCount - 1);
    } else {
      this.activeUserJobs.delete(userId);
    }

    const projCount = this.activeProjectJobs.get(projectId) || 0;
    if (projCount > 1) {
      this.activeProjectJobs.set(projectId, projCount - 1);
    } else {
      this.activeProjectJobs.delete(projectId);
    }
  }

  private mapBullStateToJobStatus(state: string): JobStatus {
    switch (state) {
      case 'waiting':
      case 'delayed':
        return JobStatus.QUEUED;
      case 'active':
        return JobStatus.RUNNING;
      case 'completed':
        return JobStatus.SUCCESS;
      case 'failed':
        return JobStatus.SYSTEM_ERROR;
      default:
        return JobStatus.QUEUED;
    }
  }
}
