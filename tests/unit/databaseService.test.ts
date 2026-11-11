import path from 'path';
import fs from 'fs/promises';
import { DatabaseService, ExecutionRecord } from '../../server/database/databaseService';
import { JobStatus } from '../../shared/types';

describe('DatabaseService & Durable Persistence Unit Tests', () => {
  const testDbDir = path.resolve(process.cwd(), 'data', 'test-db');
  let db: DatabaseService;

  beforeEach(async () => {
    try {
      await fs.rm(testDbDir, { recursive: true, force: true });
    } catch { }
    db = DatabaseService.getInstance(testDbDir);
    db.clear();
  });

  it('should persist and retrieve an execution record by jobId', async () => {
    const record: ExecutionRecord = {
      executionId: 'exec-test-1',
      jobId: 'job-test-1',
      userId: 'user-alice',
      projectId: 'proj-alpha',
      traceId: 'trace-test-1',
      entryFile: 'index.js',
      status: JobStatus.SUCCESS,
      exitCode: 0,
      durationMs: 45,
      memoryBytes: 15000000,
      createdAt: Date.now(),
      outputPreview: 'Hello World from Alice\n',
    };

    await db.saveExecution(record);

    const retrieved = await db.getExecutionByJobId('job-test-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.jobId).toBe('job-test-1');
    expect(retrieved?.userId).toBe('user-alice');
    expect(retrieved?.status).toBe(JobStatus.SUCCESS);
    expect(retrieved?.durationMs).toBe(45);
  });

  it('should query execution history by user and project', async () => {
    const r1: ExecutionRecord = {
      executionId: 'exec-1',
      jobId: 'job-1',
      userId: 'user-bob',
      projectId: 'proj-1',
      traceId: 't-1',
      entryFile: 'index.js',
      status: JobStatus.SUCCESS,
      exitCode: 0,
      durationMs: 30,
      memoryBytes: 10000,
      createdAt: 1000,
    };
    const r2: ExecutionRecord = {
      executionId: 'exec-2',
      jobId: 'job-2',
      userId: 'user-bob',
      projectId: 'proj-2',
      traceId: 't-2',
      entryFile: 'app.ts',
      status: JobStatus.COMPILATION_ERROR,
      exitCode: 1,
      durationMs: 80,
      memoryBytes: 10000,
      createdAt: 2000,
    };
    const r3: ExecutionRecord = {
      executionId: 'exec-3',
      jobId: 'job-3',
      userId: 'user-carol',
      projectId: 'proj-1',
      traceId: 't-3',
      entryFile: 'server.js',
      status: JobStatus.SUCCESS,
      exitCode: 0,
      durationMs: 50,
      memoryBytes: 10000,
      createdAt: 3000,
    };

    await db.saveExecution(r1);
    await db.saveExecution(r2);
    await db.saveExecution(r3);

    const bobExecs = await db.getExecutionsByUser('user-bob');
    expect(bobExecs.length).toBe(2);
    expect(bobExecs.map((e) => e.jobId)).toEqual(['job-2', 'job-1']); // Sorted desc

    const proj1Execs = await db.getExecutionsByProject('proj-1');
    expect(proj1Execs.length).toBe(2);
    expect(proj1Execs.map((e) => e.userId)).toContain('user-bob');
    expect(proj1Execs.map((e) => e.userId)).toContain('user-carol');
  });

  it('should calculate duration percentiles (p50, p95, p99)', async () => {
    // Insert durations: 10, 20, 30, 40, 50, 60, 70, 80, 90, 100
    for (let i = 1; i <= 10; i++) {
      await db.saveExecution({
        executionId: `exec-${i}`,
        jobId: `job-${i}`,
        userId: 'user-perf',
        projectId: 'proj-perf',
        traceId: `t-${i}`,
        entryFile: 'index.js',
        status: JobStatus.SUCCESS,
        exitCode: 0,
        durationMs: i * 10,
        memoryBytes: 1000,
        createdAt: Date.now() + i,
      });
    }

    const metrics = db.getMetrics();
    expect(metrics.totalRecords).toBe(10);
    expect(metrics.durationPercentiles.p50).toBeGreaterThanOrEqual(50);
    expect(metrics.durationPercentiles.p95).toBeGreaterThanOrEqual(90);
    expect(metrics.durationPercentiles.avg).toBe(55);
  });

  it('should truncate excessively large output previews to 10KB max', async () => {
    const hugeOutput = 'x'.repeat(25000);
    await db.saveExecution({
      executionId: 'exec-large',
      jobId: 'job-large',
      userId: 'user-large',
      projectId: 'proj-large',
      traceId: 't-large',
      entryFile: 'index.js',
      status: JobStatus.SUCCESS,
      exitCode: 0,
      durationMs: 10,
      memoryBytes: 1000,
      createdAt: Date.now(),
      outputPreview: hugeOutput,
    });

    const retrieved = await db.getExecutionByJobId('job-large');
    expect(retrieved?.outputPreview?.length).toBeLessThan(11000);
    expect(retrieved?.outputPreview).toContain('[truncated]');
  });
});
