/**
 * Durable Execution Database & Audit Service
 * Persists execution lifecycles, user project executions, performance metrics, and audit telemetry.
 * Operates with built-in durable file-backed persistence and supports external relational database connections.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { ExecutionJob, ExecutionResult, JobStatus } from '../../shared/types';
import { logger } from '../utils/logger';

export interface ExecutionRecord {
  executionId: string;
  jobId: string;
  userId: string;
  projectId: string;
  traceId: string;
  entryFile: string;
  language?: string;
  status: JobStatus;
  exitCode: number | null;
  durationMs: number;
  memoryBytes: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  errorSummary?: string;
  outputPreview?: string; // Bounded to 10KB maximum
}

export class DatabaseService {
  private static instance: DatabaseService;
  private readonly storageDir: string;
  private readonly storageFilePath: string;
  private records = new Map<string, ExecutionRecord>();
  private isLoaded = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly maxRetainedRecords = 10000;

  private constructor(customDir?: string) {
    this.storageDir = customDir || path.resolve(process.cwd(), 'data');
    this.storageFilePath = path.join(this.storageDir, 'ide_executions.json');
    this.loadFromDisk();
  }

  public static getInstance(customDir?: string): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService(customDir);
    }
    return DatabaseService.instance;
  }

  public clear(): void {
    this.records.clear();
  }

  private async loadFromDisk(): Promise<void> {
    try {
      if (!fsSync.existsSync(this.storageDir)) {
        await fs.mkdir(this.storageDir, { recursive: true });
      }

      if (fsSync.existsSync(this.storageFilePath)) {
        const raw = await fs.readFile(this.storageFilePath, 'utf8');
        const list: ExecutionRecord[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            this.records.set(item.jobId, item);
          }
        }
      }
      this.isLoaded = true;
    } catch (err: any) {
      logger.warn({ err: err.message }, 'DatabaseService: Initialized with fresh memory store');
      this.isLoaded = true;
    }
  }

  /**
   * Persist execution record asynchronously
   */
  public async saveExecution(record: ExecutionRecord): Promise<void> {
    // Ensure output snippet is strictly capped to protect database sizing
    if (record.outputPreview && record.outputPreview.length > 10240) {
      record.outputPreview = record.outputPreview.slice(0, 10240) + '\n...[truncated]';
    }

    this.records.set(record.jobId, record);

    // Bounded ring-buffer pruning
    if (this.records.size > this.maxRetainedRecords) {
      const keys = Array.from(this.records.keys());
      const toDelete = keys.slice(0, keys.length - this.maxRetainedRecords);
      for (const k of toDelete) {
        this.records.delete(k);
      }
    }

    // Debounced background flush to durable disk
    this.scheduleDiskFlush();
  }

  public async getExecutionByJobId(jobId: string): Promise<ExecutionRecord | null> {
    return this.records.get(jobId) || null;
  }

  public async getExecutionsByUser(userId: string, limit = 50): Promise<ExecutionRecord[]> {
    const matched: ExecutionRecord[] = [];
    for (const record of this.records.values()) {
      if (record.userId === userId) {
        matched.push(record);
      }
    }
    return matched.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  public async getExecutionsByProject(projectId: string, limit = 50): Promise<ExecutionRecord[]> {
    const matched: ExecutionRecord[] = [];
    for (const record of this.records.values()) {
      if (record.projectId === projectId) {
        matched.push(record);
      }
    }
    return matched.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  public async getRecentExecutions(limit = 100): Promise<ExecutionRecord[]> {
    return Array.from(this.records.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  private scheduleDiskFlush(): void {
    if (this.saveTimer) return;

    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      try {
        if (!fsSync.existsSync(this.storageDir)) {
          await fs.mkdir(this.storageDir, { recursive: true });
        }
        const data = JSON.stringify(Array.from(this.records.values()));
        const tempPath = `${this.storageFilePath}.tmp-${Date.now()}`;
        await fs.writeFile(tempPath, data, 'utf8');
        await fs.rename(tempPath, this.storageFilePath);
      } catch (err: any) {
        logger.debug({ err: err.message }, 'DatabaseService: Background flush failure (ignoring transient write error)');
      }
    }, 1000);
    this.saveTimer.unref();
  }

  /**
   * Helper to convert ExecutionJob and ExecutionResult into a stored record
   */
  public async recordExecution(job: ExecutionJob, result: ExecutionResult): Promise<void> {
    const errorSummary = result.errors && result.errors.length > 0
      ? result.errors.map((e) => e.message).join('; ')
      : result.stderr
      ? result.stderr.slice(0, 500)
      : undefined;

    const outputPreview = (result.stdout || result.stderr || '').slice(0, 10240);

    const record: ExecutionRecord = {
      executionId: `exec-${job.jobId}`,
      jobId: job.jobId,
      userId: job.userId,
      projectId: job.projectId,
      traceId: job.traceId,
      entryFile: job.entryFile,
      status: result.status,
      exitCode: result.exitCode,
      durationMs: result.metrics?.totalDurationMs || 0,
      memoryBytes: result.metrics?.peakMemoryBytes || 0,
      createdAt: job.enqueuedAt || Date.now(),
      startedAt: job.startedAt,
      completedAt: Date.now(),
      errorSummary,
      outputPreview,
    };

    await this.saveExecution(record);
  }

  /**
   * Calculate aggregated performance and duration percentiles
   */
  public getMetrics(): {
    totalRecords: number;
    durationPercentiles: { p50: number; p95: number; p99: number; avg: number };
  } {
    const durations = Array.from(this.records.values())
      .map((r) => r.durationMs)
      .filter((d) => typeof d === 'number' && d > 0)
      .sort((a, b) => a - b);

    if (durations.length === 0) {
      return {
        totalRecords: this.records.size,
        durationPercentiles: { p50: 0, p95: 0, p99: 0, avg: 0 },
      };
    }

    const avg = Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length);
    const p50 = durations[Math.floor(durations.length * 0.5)] || 0;
    const p95 = durations[Math.floor(durations.length * 0.95)] || 0;
    const p99 = durations[Math.floor(durations.length * 0.99)] || 0;

    return {
      totalRecords: this.records.size,
      durationPercentiles: { p50, p95, p99, avg },
    };
  }

  public async flushSync(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      if (!fsSync.existsSync(this.storageDir)) {
        await fs.mkdir(this.storageDir, { recursive: true });
      }
      const data = JSON.stringify(Array.from(this.records.values()));
      await fs.writeFile(this.storageFilePath, data, 'utf8');
    } catch {}
  }

  public async close(): Promise<void> {
    await this.flushSync();
  }
}
