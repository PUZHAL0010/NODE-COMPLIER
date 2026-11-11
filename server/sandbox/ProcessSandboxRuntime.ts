/**
 * Process-Level Sandbox Runtime
 * Fallback and test runtime implementing the exact SandboxRuntime contract with process isolation,
 * ephemeral workspace mounts, memory limits, and strict process tree termination.
 */

import { spawn, execFile, execFileSync } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import {
  ExecutionJob,
  ExecutionLimits,
  JobStatus,
  StreamChunk,
} from '../../shared/types';
import { SandboxInstance, SandboxRuntime } from './SandboxRuntime';
import { BoundedOutputCollector } from '../utils/bufferSafety';
import { logger } from '../utils/logger';
import { ensurePortAvailable, killProcessOnPort } from '../utils/portManager';

export class ProcessSandboxRuntime implements SandboxRuntime {
  private readonly baseWorkspaceDir: string;

  constructor(
    baseWorkspaceDir = process.env.SANDBOX_WORKSPACE_DIR || path.join(os.tmpdir(), 'ide-process-sandboxes')
  ) {
    this.baseWorkspaceDir = baseWorkspaceDir;
  }

  public async create(job: ExecutionJob): Promise<SandboxInstance> {
    const sandboxId = `proc-sandbox-${job.jobId}-${Date.now()}`;
    const workspaceDir = path.join(this.baseWorkspaceDir, sandboxId);

    await fs.mkdir(workspaceDir, { recursive: true });

    return {
      id: sandboxId,
      jobId: job.jobId,
      workspaceDir,
      createdAt: Date.now(),
    };
  }

  public async execute(
    sandbox: SandboxInstance,
    command: string[],
    limits: ExecutionLimits,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<{
    jobId: string;
    status: JobStatus;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    jsonOutput: Record<string, unknown> | Array<unknown> | null;
    metrics: {
      queueWaitMs: number;
      compileDurationMs: number;
      executionDurationMs: number;
      totalDurationMs: number;
      peakMemoryBytes: number;
      stdoutBytes: number;
      stderrBytes: number;
      exitCode: number | null;
      workerId: string;
      sandboxId: string;
    };
  }> {
    const stdoutCollector = new BoundedOutputCollector(limits.maxStdoutBytes);
    const stderrCollector = new BoundedOutputCollector(limits.maxStderrBytes);

    const startTime = Date.now();
    let isTimedOut = false;
    let isCancelled = false;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let childProcess: ReturnType<typeof spawn> | null = null;

    const devPort = await ensurePortAvailable(3001);
    sandbox.assignedPort = devPort;

    return new Promise((resolve) => {
      try {
        const [executable, ...args] = command;
        const nodeBin = !executable || executable === 'node' ? process.execPath : executable;
        const processArgs = [
          `--max-old-space-size=${limits.memoryMb}`,
          '--no-warnings',
          ...args,
        ];

        const appNodeModules = path.resolve(process.cwd(), 'node_modules');
        const nodePath = process.env.NODE_PATH
          ? `${appNodeModules}${path.delimiter}${process.env.NODE_PATH}`
          : appNodeModules;

        // Launch isolated child process in the workspace directory with sanitized environment and module access
        childProcess = spawn(nodeBin, processArgs, {
          cwd: sandbox.workspaceDir,
          env: {
            NODE_ENV: 'production',
            NODE_PATH: nodePath,
            PATH: process.env.PATH,
            PORT: String(devPort),
            HOME: sandbox.workspaceDir,
            TMPDIR: sandbox.workspaceDir,
            ...(process.platform === 'win32'
              ? {
                  SystemRoot: process.env.SystemRoot || 'C:\\Windows',
                  WINDIR: process.env.WINDIR || 'C:\\Windows',
                  TEMP: sandbox.workspaceDir,
                  TMP: sandbox.workspaceDir,
                }
              : {}),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        });

        sandbox.pid = childProcess.pid;

        // Set hard execution timeout
        timeoutTimer = setTimeout(() => {
          isTimedOut = true;
          logger.warn({ sandboxId: sandbox.id, jobId: sandbox.jobId }, 'Process execution timed out');
          this.killProcessTree(childProcess);
        }, limits.timeoutMs);

        // Process stdout
        childProcess.stdout?.on('data', (data: Buffer) => {
          stdoutCollector.append(data);
          const chunkStr = data.toString('utf8');
          if (onChunk) {
            onChunk({
              type: 'stdout',
              timestamp: Date.now(),
              data: chunkStr,
            });
          }
        });

        // Process stderr
        childProcess.stderr?.on('data', (data: Buffer) => {
          stderrCollector.append(data);
          const chunkStr = data.toString('utf8');
          if (onChunk) {
            onChunk({
              type: 'stderr',
              timestamp: Date.now(),
              data: chunkStr,
            });
          }
        });

        childProcess.on('error', (err: Error) => {
          logger.error({ sandboxId: sandbox.id, err }, 'Child process error');
          stderrCollector.append(`\nProcess launch error: ${err.message}\n`);
        });

        childProcess.on('close', (code: number | null) => {
          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
          }

          const executionDurationMs = Date.now() - startTime;
          const finalStdout = stdoutCollector.toString();
          const finalStderr = stderrCollector.toString();

          let status: JobStatus = JobStatus.SUCCESS;
          if (isTimedOut) {
            status = JobStatus.TIMEOUT;
          } else if (isCancelled) {
            status = JobStatus.CANCELLED;
          } else if (code !== 0) {
            status = JobStatus.RUNTIME_ERROR;
          }

          // Structured JSON output detection (safe parsing with JSON.parse)
          let jsonOutput: Record<string, unknown> | Array<unknown> | null = null;
          try {
            const trimmed = finalStdout.trim();
            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
              jsonOutput = JSON.parse(trimmed);
            } else {
              const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
              if (match) {
                jsonOutput = JSON.parse(match[0]);
              }
            }
          } catch {
            jsonOutput = null;
          }

          resolve({
            jobId: sandbox.jobId,
            status,
            exitCode: code,
            stdout: finalStdout,
            stderr: finalStderr,
            jsonOutput,
            metrics: {
              queueWaitMs: 0,
              compileDurationMs: 0,
              executionDurationMs,
              totalDurationMs: executionDurationMs,
              peakMemoryBytes: 0,
              stdoutBytes: stdoutCollector.getBytesWritten(),
              stderrBytes: stderrCollector.getBytesWritten(),
              exitCode: code,
              workerId: process.env.WORKER_ID || 'worker-proc',
              sandboxId: sandbox.id,
            },
          });
        });
      } catch (err: unknown) {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        logger.error({ sandboxId: sandbox.id, err }, 'Exception in ProcessSandboxRuntime');
        resolve({
          jobId: sandbox.jobId,
          status: JobStatus.SYSTEM_ERROR,
          exitCode: 1,
          stdout: stdoutCollector.toString(),
          stderr: (err instanceof Error ? err.message : String(err)),
          jsonOutput: null,
          metrics: {
            queueWaitMs: 0,
            compileDurationMs: 0,
            executionDurationMs: Date.now() - startTime,
            totalDurationMs: Date.now() - startTime,
            peakMemoryBytes: 0,
            stdoutBytes: stdoutCollector.getBytesWritten(),
            stderrBytes: stderrCollector.getBytesWritten(),
            exitCode: 1,
            workerId: process.env.WORKER_ID || 'worker-proc',
            sandboxId: sandbox.id,
          },
        });
      }
    });
  }

  public async cancel(sandbox: SandboxInstance): Promise<void> {
    if (sandbox.pid) {
      try {
        this.killProcessTreeByPid(sandbox.pid);
      } catch (err) {
        logger.debug({ pid: sandbox.pid, err }, 'Process already killed on cancel');
      }
    }
    if (sandbox.assignedPort) {
      await killProcessOnPort(sandbox.assignedPort).catch(() => {});
    }
  }

  public async destroy(sandbox: SandboxInstance): Promise<void> {
    if (sandbox.pid) {
      try {
        this.killProcessTreeByPid(sandbox.pid);
      } catch {
        // Process already dead
      }
    }
    if (sandbox.assignedPort) {
      await killProcessOnPort(sandbox.assignedPort).catch(() => {});
    }
    try {
      await fs.rm(sandbox.workspaceDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn({ workspaceDir: sandbox.workspaceDir, err }, 'Failed to remove process sandbox workspace');
    }
  }

  private killProcessTree(child: ReturnType<typeof spawn> | null): void {
    if (!child || !child.pid) return;
    this.killProcessTreeByPid(child.pid, child);
  }

  private killProcessTreeByPid(pid: number, childHandle?: ReturnType<typeof spawn> | null): void {
    if (!pid) return;

    if (process.platform === 'win32') {
      const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
      const taskkill = path.join(systemRoot, 'System32', 'taskkill.exe');
      const binary = fsSync.existsSync(taskkill) ? taskkill : 'taskkill';

      try {
        execFileSync(binary, ['/pid', pid.toString(), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      } catch {
        try {
          if (childHandle) childHandle.kill('SIGKILL');
          else process.kill(pid, 'SIGKILL');
        } catch {}
      }
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          if (childHandle) childHandle.kill('SIGKILL');
          else process.kill(pid, 'SIGKILL');
        } catch {}
      }
    }
  }
}
