/**
 * Distributed BullMQ Worker Pool Supervisor
 * Consumes jobs from the 'node-execution' queue, executes them within isolated sandboxes,
 * and maintains worker health and concurrency controls.
 */

import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { ExecutionJob, ExecutionResult } from '../shared/types';
import { ExecutionProcessor } from './processor';
import { logger } from './utils/logger';

const QUEUE_NAME = process.env.QUEUE_NAME || 'node-execution';
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '8', 10);
const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;

export class WorkerPool {
  private worker: Worker<ExecutionJob, ExecutionResult> | null = null;
  private processor: ExecutionProcessor;
  private isShuttingDown = false;
  private redisConnection: Redis | null = null;
  private cancelSubscriber: Redis | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private activeJobCount = 0;

  constructor() {
    this.processor = new ExecutionProcessor();
  }

  public async start(): Promise<void> {
    logger.info(
      { workerId: WORKER_ID, concurrency: WORKER_CONCURRENCY, queue: QUEUE_NAME },
      'Starting BullMQ Worker Pool...'
    );

    const redisConfig = {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => Math.min(times * 200, 3000),
    };

    this.redisConnection = new Redis(redisConfig as any);
    this.cancelSubscriber = new Redis(redisConfig as any);

    // Publish periodic worker health heartbeat to Redis
    this.startHeartbeat();

    this.cancelSubscriber.subscribe('job:cancel').catch(() => {});
    this.cancelSubscriber.on('message', async (channel: string, message: string) => {
      if (channel === 'job:cancel') {
        try {
          const payload = JSON.parse(message);
          if (payload.jobId) {
            await ExecutionProcessor.cancelJob(payload.jobId);
          } else if (payload.projectId) {
            await ExecutionProcessor.cancelJobsForProject(payload.projectId);
          }
        } catch {}
      }
    });

    this.worker = new Worker<ExecutionJob, ExecutionResult>(
      QUEUE_NAME,
      async (job: Job<ExecutionJob, ExecutionResult>) => {
        logger.info({ jobId: job.data.jobId, workerId: WORKER_ID }, 'Processing execution job');
        job.data.startedAt = Date.now();
        this.activeJobCount++;

        // Update distributed job status & track active jobs for user
        if (this.redisConnection) {
          try {
            await this.redisConnection.hset(`job:meta:${job.data.jobId}`, {
              status: 'RUNNING',
              startedAt: job.data.startedAt.toString(),
              workerId: WORKER_ID,
            });
            await this.redisConnection.sadd(`user:active_jobs:${job.data.userId}`, job.data.jobId);
          } catch (err) {
            logger.debug({ jobId: job.data.jobId, err }, 'Failed to record job running status in Redis');
          }
        }

        try {
          const result = await this.processor.processJob(job.data);

          // Update distributed job status to finished
          if (this.redisConnection) {
            try {
              await this.redisConnection.hset(`job:meta:${job.data.jobId}`, {
                status: result.status,
                result: JSON.stringify(result),
              });
              await this.redisConnection.srem(`user:active_jobs:${job.data.userId}`, job.data.jobId);
            } catch (err) {
              logger.debug({ jobId: job.data.jobId, err }, 'Failed to record job complete status in Redis');
            }
          }

          return result;
        } finally {
          this.activeJobCount--;
          if (this.redisConnection) {
            await this.redisConnection.srem(`user:active_jobs:${job.data.userId}`, job.data.jobId).catch(() => {});
          }
        }
      },
      {
        connection: this.redisConnection as any,
        concurrency: WORKER_CONCURRENCY,
        lockDuration: 30000,
        stalledInterval: 15000,
        skipVersionCheck: true,
      }
    );

    this.worker.on('completed', (job) => {
      logger.info({ jobId: job.data.jobId, status: job.returnvalue?.status }, 'Job execution completed');
    });

    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.data?.jobId, err: err.message }, 'Job execution failed with error');
    });

    this.worker.on('error', (err) => {
      logger.error({ err: err.message }, 'Worker pool error encountered');
    });

    this.worker.on('stalled', (jobId) => {
      logger.warn({ jobId }, 'Job identified as stalled; will be recovered or moved');
    });

    logger.info('Worker pool initialized and awaiting jobs.');
  }

  private startHeartbeat(): void {
    const sendPulse = async () => {
      if (this.redisConnection && !this.isShuttingDown) {
        try {
          const heartbeatKey = `worker:heartbeat:${WORKER_ID}`;
          const payload = JSON.stringify({
            workerId: WORKER_ID,
            concurrency: WORKER_CONCURRENCY,
            activeJobs: this.activeJobCount,
            timestamp: Date.now(),
            pid: process.pid,
            status: 'ALIVE',
          });
          await this.redisConnection.set(heartbeatKey, payload, 'EX', 15);
        } catch (err) {
          logger.debug({ workerId: WORKER_ID, err }, 'Failed to publish worker heartbeat');
        }
      }
    };

    sendPulse();
    this.heartbeatTimer = setInterval(sendPulse, 5000);
    this.heartbeatTimer.unref();
  }

  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    logger.info('Gracefully shutting down worker pool...');
    if (this.redisConnection) {
      try {
        await this.redisConnection.del(`worker:heartbeat:${WORKER_ID}`);
      } catch {}
    }
    if (this.worker) {
      await this.worker.close();
    }
    if (this.cancelSubscriber) {
      await this.cancelSubscriber.quit().catch(() => {});
    }
    if (this.redisConnection) {
      await this.redisConnection.quit();
    }
    logger.info('Worker pool shutdown complete.');
  }
}

// Auto-run if executed directly
if (require.main === module) {
  const pool = new WorkerPool();
  pool.start().catch((err) => {
    logger.fatal({ err }, 'Fatal failure starting WorkerPool');
    process.exit(1);
  });

  const handleShutdown = async (signal: string) => {
    logger.info({ signal }, 'Termination signal received');
    await pool.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}
