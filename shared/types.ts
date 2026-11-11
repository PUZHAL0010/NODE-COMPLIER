/**
 * Core Shared Domain Types and Enums
 * For Distributed Node.js Web IDE & Secure Execution Platform
 */

export enum JobStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  COMPILATION_ERROR = 'COMPILATION_ERROR',
  RUNTIME_ERROR = 'RUNTIME_ERROR',
  TIMEOUT = 'TIMEOUT',
  CANCELLED = 'CANCELLED',
  SECURITY_VIOLATION = 'SECURITY_VIOLATION',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
}

export type SupportedFileExtension =
  | '.html'
  | '.css'
  | '.js'
  | '.mjs'
  | '.cjs'
  | '.ts'
  | '.tsx'
  | '.jsx'
  | '.json'
  | '.ejs';

export interface ProjectFile {
  path: string;
  content: string;
  type?: string;
}

export interface ExecutionOptions {
  timeoutMs?: number;
  environment?: string;
  memoryMb?: number;
  cpus?: number;
}

export interface ExecutionRequest {
  projectId: string;
  entryFile: string;
  files: ProjectFile[];
  options?: ExecutionOptions;
}

export interface ExecutionLimits {
  timeoutMs: number;
  memoryMb: number;
  cpus: number;
  pids: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}

export interface ExecutionJob extends ExecutionRequest {
  jobId: string;
  userId: string;
  traceId: string;
  enqueuedAt: number;
  startedAt?: number;
  completedAt?: number;
  limits: ExecutionLimits;
}

export interface CompilationDiagnostic {
  file: string;
  line: number;
  column: number;
  message: string;
  code?: number | string;
}

export interface SecurityViolation {
  file: string;
  rule: string;
  message: string;
  line?: number;
  column?: number;
}

export interface JobMetrics {
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
}

export interface ExecutionResult {
  jobId: string;
  status: JobStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  htmlPreviewBundle: PreviewBundle | string | null;
  jsonOutput: Record<string, unknown> | Array<unknown> | null;
  metrics: JobMetrics;
  errors: CompilationDiagnostic[];
  violations: SecurityViolation[];
}

export type StreamEventType =
  | 'stdout'
  | 'stderr'
  | 'status'
  | 'compile_error'
  | 'runtime_error'
  | 'alert'
  | 'metrics'
  | 'exit'
  | 'ping'
  | 'endpoints'
  | 'preview';

export interface StreamChunk {
  type: StreamEventType;
  timestamp: number;
  data: string | Record<string, unknown> | JobMetrics | CompilationDiagnostic | SystemAlert;
}

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertCategory =
  | 'CRASH'
  | 'TIMEOUT'
  | 'OOM'
  | 'SECURITY'
  | 'CIRCUIT_BREAKER'
  | 'SYSTEM';

export interface SystemAlert {
  alertId: string;
  timestamp: string;
  severity: AlertSeverity;
  category: AlertCategory;
  jobId?: string;
  traceId?: string;
  message: string;
  details?: Record<string, unknown>;
  systemMetricsSnapshot?: {
    memoryUsageBytes: number;
    uptimeSeconds: number;
    activeJobs: number;
  };
}

export interface PreviewBundle {
  html: string;
  css: string;
  js: string;
  csp: string;
  bundledHtml: string;
  virtualPages?: Record<string, string>;
}

export interface QueueMetrics {
  waitingCount: number;
  activeCount: number;
  completedCount: number;
  failedCount: number;
  delayedCount: number;
  workerConcurrency: number;
  totalThroughputPerMin: number;
}
