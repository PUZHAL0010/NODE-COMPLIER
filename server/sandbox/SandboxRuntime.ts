/**
 * Pluggable Sandbox Runtime Interface
 * Decouples execution engines (Docker, Firecracker, gVisor, or Process Isolation)
 * from the high-level job dispatcher.
 */

import { ExecutionJob, ExecutionLimits, ExecutionResult, StreamChunk } from '../../shared/types';

export interface SandboxInstance {
  id: string;
  jobId: string;
  workspaceDir: string;
  containerId?: string;
  pid?: number;
  assignedPort?: number;
  createdAt: number;
}

export interface SandboxRuntime {
  /**
   * Initialize a new isolated sandbox workspace and container/VM
   */
  create(job: ExecutionJob): Promise<SandboxInstance>;

  /**
   * Execute a command within the sandboxed environment with strict resource limits and real-time streaming
   */
  execute(
    sandbox: SandboxInstance,
    command: string[],
    limits: ExecutionLimits,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<Omit<ExecutionResult, 'htmlPreviewBundle' | 'errors' | 'violations'>>;

  /**
   * Gracefully terminate or kill the execution process group inside the sandbox
   */
  cancel(sandbox: SandboxInstance): Promise<void>;

  /**
   * Destroy the sandbox and clean up all ephemeral workspace files and container resources
   */
  destroy(sandbox: SandboxInstance): Promise<void>;
}
