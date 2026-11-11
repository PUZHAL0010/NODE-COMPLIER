/**
 * Node.js Compiler Platform — Unified SDK & Module Entry Point
 * Designed for direct embedding into existing Node.js parent platforms.
 */

import { createApp, createCompilerRouter } from './gateway';
import { ExecutionProcessor } from './processor';
import { ProcessSandboxRuntime } from './sandbox/ProcessSandboxRuntime';
import { DockerSandboxRuntime } from './sandbox/DockerSandboxRuntime';
import { SandboxRuntime } from './sandbox/SandboxRuntime';
import { JobService } from './services/jobService';
import { StreamService } from './services/streamService';
import { PreviewService } from './services/previewService';
import { MetricsService } from './services/metricsService';
import { compileTypeScriptProject } from './compiler/tsCompiler';
import { scanProjectAst } from './validation/astSecurityAnalyzer';
import { validateProjectFiles, normalizeAndValidatePath } from './validation/fileValidation';
import { resolveExecutionLimits, SYSTEM_LIMITS } from './utils/limits';
import {
  ExecutionRequest,
  ExecutionResult,
  ExecutionJob,
  ExecutionLimits,
  JobStatus,
  ProjectFile,
  PreviewBundle,
  StreamChunk,
  StreamEventType,
  CompilationDiagnostic,
  SecurityViolation,
} from '../shared/types';

/**
 * Programmatic Execution Function
 * Execute a Node.js project directly from parent backend code without HTTP requests.
 */
export async function executeNodeProject(
  request: ExecutionRequest,
  options?: {
    runtime?: SandboxRuntime;
    onChunk?: (chunk: StreamChunk) => void;
    userId?: string;
  }
): Promise<ExecutionResult> {
  const limits = resolveExecutionLimits(request.options);
  const validatedFiles = validateProjectFiles(request.files, request.entryFile);

  const job: ExecutionJob = {
    ...request,
    files: validatedFiles,
    jobId: `sdk-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userId: options?.userId || 'parent-platform',
    traceId: `sdk-trace-${Date.now()}`,
    enqueuedAt: Date.now(),
    limits,
  };

  const processor = new ExecutionProcessor(options?.runtime);
  return processor.processJob(job);
}

import {
  routeExecutionPipeline,
  detectFileLanguage,
  LanguageType,
  PipelineType,
} from './compiler/languageRouter';

// Re-export Core Services & Utilities
export {
  createApp,
  createCompilerRouter,
  ExecutionProcessor,
  ProcessSandboxRuntime,
  DockerSandboxRuntime,
  SandboxRuntime,
  JobService,
  StreamService,
  PreviewService,
  MetricsService,
  compileTypeScriptProject,
  routeExecutionPipeline,
  detectFileLanguage,
  LanguageType,
  PipelineType,
  scanProjectAst,
  validateProjectFiles,
  normalizeAndValidatePath,
  resolveExecutionLimits,
  SYSTEM_LIMITS,
};

// Re-export Domain Types
export type {
  ExecutionRequest,
  ExecutionResult,
  ExecutionJob,
  ExecutionLimits,
  ProjectFile,
  PreviewBundle,
  StreamChunk,
  StreamEventType,
  CompilationDiagnostic,
  SecurityViolation,
};

export { JobStatus };
