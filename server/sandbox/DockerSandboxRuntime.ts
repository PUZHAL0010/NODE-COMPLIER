/**
 * Production-Ready Docker Sandbox Runtime
 * Enforces zero network, rootless execution, drop-capabilities, memory/CPU quotas, and PID limits.
 */

import { spawn, execFile } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { promisify } from 'util';
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

const execFileAsync = promisify(execFile);

export class DockerSandboxRuntime implements SandboxRuntime {
  private readonly dockerImage: string;
  private readonly baseWorkspaceDir: string;

  constructor(
    dockerImage = process.env.DOCKER_IMAGE || 'node:20-alpine',
    baseWorkspaceDir = process.env.SANDBOX_WORKSPACE_DIR || path.join(os.tmpdir(), 'ide-sandboxes')
  ) {
    this.dockerImage = dockerImage;
    this.baseWorkspaceDir = baseWorkspaceDir;
  }

  public async create(job: ExecutionJob): Promise<SandboxInstance> {
    const sandboxId = `sandbox-${job.jobId}-${Date.now()}`;
    const workspaceDir = path.join(this.baseWorkspaceDir, sandboxId);

    // Create host workspace directory
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
    const containerName = `run-${sandbox.id}`;
    sandbox.containerId = containerName;

    // Detect if running inside a container (Docker-in-Docker / sibling containers)
    const isInDockerContainer = fsSync.existsSync('/.dockerenv') || Boolean(process.env.DOCKER_CONTAINER);
    const containerHost = process.env.HOSTNAME;

    const mountArgs = (isInDockerContainer && containerHost)
      ? ['--volumes-from', containerHost, '-w', sandbox.workspaceDir]
      : ['-v', `${sandbox.workspaceDir}:/workspace:rw`, '-w', '/workspace'];

    const devPort = await ensurePortAvailable(3001);
    sandbox.assignedPort = devPort;

    // Hardened Docker container execution flags
    const dockerArgs = [
      'run',
      '--name', containerName,
      '--rm',
      '--network', 'none',                 // Zero network access
      '--cap-drop', 'ALL',                 // Drop all Linux capabilities
      '--security-opt', 'no-new-privileges:true',
      '--read-only',                       // Read-only root filesystem
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
      '--user', 'node',                    // Enforce non-root execution
      '--memory', `${limits.memoryMb}m`,   // Memory cap
      '--memory-swap', `${limits.memoryMb}m`, // Prevent swap expansion
      '--cpus', `${limits.cpus}`,          // CPU quota
      '--pids-limit', `${limits.pids}`,    // Fork-bomb mitigation
      '-e', `PORT=${devPort}`,             // Dynamically verified developer server port (avoids 3000 collision)
      ...mountArgs,
      this.dockerImage,
      ...command,
    ];

    const stdoutCollector = new BoundedOutputCollector(limits.maxStdoutBytes);
    const stderrCollector = new BoundedOutputCollector(limits.maxStderrBytes);

    const startTime = Date.now();
    let isTimedOut = false;
    let isCancelled = false;
    let childProcess: ReturnType<typeof spawn> | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;

    return new Promise((resolve) => {
      try {
        childProcess = spawn('docker', dockerArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        sandbox.pid = childProcess.pid;

        // Set hard execution timeout guard
        timeoutTimer = setTimeout(async () => {
          isTimedOut = true;
          logger.warn({ sandboxId: sandbox.id, jobId: sandbox.jobId }, 'Execution exceeded timeout limit');
          try {
            await execFileAsync('docker', ['kill', containerName]).catch(() => {});
          } catch {
            // Container may have already terminated
          }
          if (childProcess) {
            childProcess.kill('SIGKILL');
          }
        }, limits.timeoutMs);

        // Process stdout stream
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

        // Process stderr stream
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
          logger.error({ sandboxId: sandbox.id, err }, 'Docker spawn process error');
          stderrCollector.append(`\nSystem execution error: ${err.message}\n`);
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
              // Check if output contains a structured JSON block
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
              workerId: process.env.WORKER_ID || 'worker-docker',
              sandboxId: sandbox.id,
            },
          });
        });
      } catch (err: unknown) {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        logger.error({ sandboxId: sandbox.id, err }, 'Exception launching docker container');
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
            workerId: process.env.WORKER_ID || 'worker-docker',
            sandboxId: sandbox.id,
          },
        });
      }
    });
  }

  public async cancel(sandbox: SandboxInstance): Promise<void> {
    if (sandbox.containerId) {
      try {
        await execFileAsync('docker', ['kill', sandbox.containerId]);
      } catch (err) {
        logger.debug({ sandboxId: sandbox.id, err }, 'Docker kill call completed or container already gone');
      }
    }
    if (sandbox.assignedPort) {
      await killProcessOnPort(sandbox.assignedPort).catch(() => {});
    }
  }

  public async destroy(sandbox: SandboxInstance): Promise<void> {
    // 1. Ensure container is removed
    if (sandbox.containerId) {
      try {
        await execFileAsync('docker', ['rm', '-f', sandbox.containerId]);
      } catch {
        // Ignored if already removed by --rm
      }
    }

    if (sandbox.assignedPort) {
      await killProcessOnPort(sandbox.assignedPort).catch(() => {});
    }

    // 2. Clean host workspace directory
    try {
      await fs.rm(sandbox.workspaceDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn({ workspaceDir: sandbox.workspaceDir, err }, 'Failed to clean up sandbox workspace directory');
    }
  }
}
