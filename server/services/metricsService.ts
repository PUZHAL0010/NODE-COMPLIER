/**
 * System & Execution Metrics Service
 * Aggregates runtime statistics, percentiles (p50, p95, p99), error distributions, and throughput.
 */

import { ExecutionResult, JobMetrics, JobStatus } from '../../shared/types';

export interface PlatformMetricsSummary {
  totalJobs: number;
  activeJobs: number;
  completedJobs: number;
  statusBreakdown: Record<JobStatus, number>;
  throughputJobsPerMinute: number;
  durationMs: {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  memoryBytes: {
    avg: number;
    max: number;
  };
  workerCount: number;
  uptimeSeconds: number;
}

export class MetricsService {
  private static instance: MetricsService;
  private readonly startTime = Date.now();
  private durations: number[] = [];
  private totalJobs = 0;
  private activeJobs = 0;
  private completedJobs = 0;
  private statusCounts: Record<JobStatus, number> = {
    [JobStatus.QUEUED]: 0,
    [JobStatus.RUNNING]: 0,
    [JobStatus.SUCCESS]: 0,
    [JobStatus.COMPILATION_ERROR]: 0,
    [JobStatus.RUNTIME_ERROR]: 0,
    [JobStatus.TIMEOUT]: 0,
    [JobStatus.CANCELLED]: 0,
    [JobStatus.SECURITY_VIOLATION]: 0,
    [JobStatus.SYSTEM_ERROR]: 0,
  };
  private jobTimestamps: number[] = [];

  private constructor() {}

  public static getInstance(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  public recordJobStarted(): void {
    this.totalJobs++;
    this.activeJobs++;
    this.statusCounts[JobStatus.RUNNING]++;
    this.jobTimestamps.push(Date.now());

    // Clean up timestamps older than 5 minutes
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    this.jobTimestamps = this.jobTimestamps.filter((t) => t > fiveMinutesAgo);
  }

  public recordJobCompleted(result: ExecutionResult): void {
    if (this.activeJobs > 0) {
      this.activeJobs--;
    }
    this.completedJobs++;
    this.statusCounts[result.status] = (this.statusCounts[result.status] || 0) + 1;

    if (result.metrics?.executionDurationMs) {
      this.durations.push(result.metrics.executionDurationMs);
      // Keep last 10,000 samples for percentile calculations
      if (this.durations.length > 10000) {
        this.durations.shift();
      }
    }
  }

  public getSummary(): PlatformMetricsSummary {
    const sortedDurations = [...this.durations].sort((a, b) => a - b);
    const count = sortedDurations.length;

    const avg = count > 0 ? sortedDurations.reduce((sum, d) => sum + d, 0) / count : 0;
    const p50 = count > 0 ? sortedDurations[Math.floor(count * 0.5)] : 0;
    const p95 = count > 0 ? sortedDurations[Math.floor(count * 0.95)] : 0;
    const p99 = count > 0 ? sortedDurations[Math.floor(count * 0.99)] : 0;

    const oneMinuteAgo = Date.now() - 60 * 1000;
    const jobsInLastMinute = this.jobTimestamps.filter((t) => t > oneMinuteAgo).length;

    return {
      totalJobs: this.totalJobs,
      activeJobs: this.activeJobs,
      completedJobs: this.completedJobs,
      statusBreakdown: { ...this.statusCounts },
      throughputJobsPerMinute: jobsInLastMinute,
      durationMs: {
        avg: Math.round(avg * 100) / 100,
        p50,
        p95,
        p99,
      },
      memoryBytes: {
        avg: 0,
        max: 512 * 1024 * 1024,
      },
      workerCount: parseInt(process.env.WORKER_CONCURRENCY || '8', 10),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }
}
