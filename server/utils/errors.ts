/**
 * Enterprise Application Error Hierarchy
 * Standardized typed error classes with operational classifications and audit metadata
 */

export abstract class AppError extends Error {
  public abstract readonly statusCode: number;
  public abstract readonly code: string;
  public readonly isOperational: boolean = true;
  public readonly timestamp: string;
  public readonly details?: Record<string, unknown> | unknown[];

  constructor(message: string, details?: Record<string, unknown> | unknown[]) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date().toISOString();
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  public toJSON() {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      details: this.details,
    };
  }
}

export class ValidationError extends AppError {
  public readonly statusCode = 400;
  public readonly code = 'VALIDATION_ERROR';
}

export class FileSecurityError extends AppError {
  public readonly statusCode = 400;
  public readonly code = 'FILE_SECURITY_VIOLATION';
}

export class ASTSecurityError extends AppError {
  public readonly statusCode = 403;
  public readonly code = 'AST_SECURITY_VIOLATION';
}

export class SSRFBlockedError extends AppError {
  public readonly statusCode = 403;
  public readonly code = 'SSRF_METADATA_BLOCKED';
}

export class ReservedPortError extends AppError {
  public readonly statusCode = 400;
  public readonly code = 'RESERVED_PORT_VIOLATION';
}

export class ExecutionTimeoutError extends AppError {
  public readonly statusCode = 408;
  public readonly code = 'EXECUTION_TIMEOUT';
}

export class SandboxOOMError extends AppError {
  public readonly statusCode = 507;
  public readonly code = 'OUT_OF_MEMORY';
}

export class CircuitBreakerError extends AppError {
  public readonly statusCode = 503;
  public readonly code = 'CIRCUIT_BREAKER_OPEN';
}

export class RateLimitExceededError extends AppError {
  public readonly statusCode = 429;
  public readonly code = 'RATE_LIMIT_EXCEEDED';
}

export class ConcurrencyLimitError extends AppError {
  public readonly statusCode = 429;
  public readonly code = 'CONCURRENCY_LIMIT_EXCEEDED';
}

export class JobNotFoundError extends AppError {
  public readonly statusCode = 404;
  public readonly code = 'JOB_NOT_FOUND';
}

export class SandboxCrashError extends AppError {
  public readonly statusCode = 500;
  public readonly code = 'SANDBOX_CRASH';
}
