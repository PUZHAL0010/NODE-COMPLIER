/**
 * Security & Resource Limits
 * Hard enforcement boundaries for user payloads and sandboxed execution
 */

import { ExecutionLimits } from '../../shared/types';

export const SYSTEM_LIMITS = {
  // Payload & Project structure limits
  MAX_REQUEST_BODY_BYTES: 5 * 1024 * 1024, // 5 MB
  MAX_PROJECT_FILES: 100,
  MAX_INDIVIDUAL_FILE_BYTES: 1 * 1024 * 1024, // 1 MB
  MAX_TOTAL_PROJECT_BYTES: 5 * 1024 * 1024, // 5 MB
  MAX_PATH_LENGTH: 255,
  MAX_DIRECTORY_DEPTH: 8,

  // Execution constraints
  DEFAULT_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes (allows persistent servers & long-running scripts)
  MAX_TIMEOUT_MS: 30 * 60 * 1000,     // 30 minutes
  MIN_TIMEOUT_MS: 100,

  DEFAULT_MEMORY_MB: 512,
  MAX_MEMORY_MB: 512,

  DEFAULT_CPUS: 1.0,
  MAX_CPUS: 1.0,

  DEFAULT_PIDS: 32,
  MAX_PIDS: 32,

  // Stream & Output bounds (prevent buffer exhaustion attacks)
  MAX_STDOUT_BYTES: 1 * 1024 * 1024, // 1 MB
  MAX_STDERR_BYTES: 1 * 1024 * 1024, // 1 MB

  // Rate limiting & concurrency quotas (tuned for 200+ concurrent users)
  RATE_LIMIT_WINDOW_MS: 60 * 1000, // 1 minute
  RATE_LIMIT_MAX_PER_IP: 2000,
  RATE_LIMIT_MAX_CONCURRENT_PER_USER: 100,
  RATE_LIMIT_MAX_CONCURRENT_PER_PROJECT: 10,
} as const;

export const ALLOWED_FILE_EXTENSIONS = new Set<string>([
  '.html',
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.json',
  '.ejs',
]);

export const FORBIDDEN_FILE_EXTENSIONS = new Set<string>([
  '.exe',
  '.dll',
  '.so',
  '.sh',
  '.bat',
  '.cmd',
  '.ps1',
  '.vbs',
  '.bin',
  '.py',
  '.rb',
  '.php',
  '.java',
  '.c',
  '.cpp',
  '.cs',
  '.rb'
]);

/**
 * Sanitize and clamp execution options against hard system limits
 */
export function resolveExecutionLimits(options?: {
  timeoutMs?: number;
  memoryMb?: number;
  cpus?: number;
}): ExecutionLimits {
  const timeoutMs = Math.min(
    Math.max(options?.timeoutMs ?? SYSTEM_LIMITS.DEFAULT_TIMEOUT_MS, SYSTEM_LIMITS.MIN_TIMEOUT_MS),
    SYSTEM_LIMITS.MAX_TIMEOUT_MS
  );

  const memoryMb = Math.min(
    Math.max(options?.memoryMb ?? SYSTEM_LIMITS.DEFAULT_MEMORY_MB, 64),
    SYSTEM_LIMITS.MAX_MEMORY_MB
  );

  const cpus = Math.min(
    Math.max(options?.cpus ?? SYSTEM_LIMITS.DEFAULT_CPUS, 0.1),
    SYSTEM_LIMITS.MAX_CPUS
  );

  return {
    timeoutMs,
    memoryMb,
    cpus,
    pids: SYSTEM_LIMITS.MAX_PIDS,
    maxStdoutBytes: SYSTEM_LIMITS.MAX_STDOUT_BYTES,
    maxStderrBytes: SYSTEM_LIMITS.MAX_STDERR_BYTES,
  };
}
