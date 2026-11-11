/**
 * Core Execution Processor
 * Manages the full job lifecycle: Validation -> AST Pre-scan -> TS Compilation ->
 * Sandbox Materialization -> Execution & Streaming -> Metrics -> Cleanup.
 */

import fs from 'fs/promises';
import path from 'path';
import {
  ExecutionJob,
  ExecutionLimits,
  ExecutionResult,
  JobStatus,
  StreamChunk,
} from '../shared/types';
import { scanProjectAst } from './validation/astSecurityAnalyzer';
import { validateProjectFiles } from './validation/fileValidation';
import { scanProjectEndpoints } from './validation/endpointScanner';
import { compileTypeScriptProject } from './compiler/tsCompiler';
import { routeExecutionPipeline, PipelineType, LanguageType } from './compiler/languageRouter';
import { validateHtmlCode, validateCssCode, validateEjsCode, formatDiagnostic } from './validation/htmlCssValidator';
import { PreviewService } from './services/previewService';
import ejs from 'ejs';
import { SandboxInstance, SandboxRuntime } from './sandbox/SandboxRuntime';
import { DockerSandboxRuntime } from './sandbox/DockerSandboxRuntime';
import { ProcessSandboxRuntime } from './sandbox/ProcessSandboxRuntime';
import { DOM_SHIM_SOURCE } from './sandbox/domShimSource';
import { StreamService } from './services/streamService';
import { MetricsService } from './services/metricsService';
import { AlertService } from './services/alertService';
import { CircuitBreaker } from './utils/circuitBreaker';
import { DatabaseService } from './database/databaseService';
import { logger } from './utils/logger';

export class ExecutionProcessor {
  private static activeSandboxes = new Map<
    string,
    { sandbox: SandboxInstance; runtime: SandboxRuntime; projectId?: string; userId?: string }
  >();
  private sandboxRuntime: SandboxRuntime;
  private streamService: StreamService;
  private metricsService: MetricsService;
  private alertService: AlertService;
  private circuitBreaker: CircuitBreaker;

  public static async cancelJob(jobId: string): Promise<boolean> {
    const entry = ExecutionProcessor.activeSandboxes.get(jobId);
    if (entry) {
      try {
        await entry.runtime.cancel(entry.sandbox);
        await entry.runtime.destroy(entry.sandbox);
        ExecutionProcessor.activeSandboxes.delete(jobId);
        return true;
      } catch (err) {
        logger.warn({ jobId, err }, 'Failed to cancel active sandbox');
      }
    }
    return false;
  }

  public static async cancelJobsForProject(projectId: string): Promise<void> {
    for (const [jobId, entry] of ExecutionProcessor.activeSandboxes.entries()) {
      if (entry.projectId === projectId) {
        logger.info({ jobId, projectId }, 'Cancelling active sandbox for project re-run');
        try {
          await entry.runtime.cancel(entry.sandbox);
          await entry.runtime.destroy(entry.sandbox);
        } catch (err) {
          logger.debug({ jobId, err }, 'Error cleaning up prior project sandbox');
        }
        ExecutionProcessor.activeSandboxes.delete(jobId);
      }
    }
  }

  constructor(customRuntime?: SandboxRuntime) {
    if (customRuntime) {
      this.sandboxRuntime = customRuntime;
    } else {
      // On Windows host, use ProcessSandboxRuntime for instant native execution without path/space mounting issues.
      // Use DockerSandboxRuntime in Linux container environments when SANDBOX_RUNTIME is 'docker'.
      const runtimeMode = process.env.SANDBOX_RUNTIME === 'docker' && process.platform !== 'win32' ? 'docker' : 'process';
      this.sandboxRuntime =
        runtimeMode === 'docker'
          ? new DockerSandboxRuntime()
          : new ProcessSandboxRuntime();
    }

    this.streamService = StreamService.getInstance();
    this.metricsService = MetricsService.getInstance();
    this.alertService = AlertService.getInstance();
    this.circuitBreaker = new CircuitBreaker({
      name: 'SandboxExecutionCircuit',
      failureThreshold: 5,
      resetTimeoutMs: 15000,
    });

    this.circuitBreaker.onTrip((err, state) => {
      this.alertService.recordCircuitTrip(
        'SandboxExecutionCircuit',
        `Execution failure threshold reached (${err.message}). Tripped to ${state}.`
      );
    });
  }

  /**
   * Process an execution job from start to finish
   */
  public async processJob(job: ExecutionJob): Promise<ExecutionResult> {
    const jobStartTime = Date.now();
    const queueWaitMs = job.startedAt ? job.startedAt - job.enqueuedAt : 0;
    let compileDurationMs = 0;

    this.metricsService.recordJobStarted();
    await this.emitStreamChunk(job.jobId, {
      type: 'status',
      timestamp: Date.now(),
      data: { status: JobStatus.RUNNING },
    });

    let sandbox: SandboxInstance | null = null;

    try {
      // Ensure any lingering sandbox for this project is cleanly cancelled
      await ExecutionProcessor.cancelJobsForProject(job.projectId);

      // 1. Re-validate project files
      const validatedFiles = validateProjectFiles(job.files, job.entryFile);

      // 2. Perform static AST security analysis (defense-in-depth)
      const violations = scanProjectAst(validatedFiles);
      if (violations.length > 0) {
        logger.info({ jobId: job.jobId, violationsCount: violations.length }, 'AST security notices logged');
        for (const v of violations) {
          this.alertService.recordSecurityIncident(v.rule, `${v.message} in ${v.file}:${v.line || 1}`, {
            jobId: job.jobId,
            traceId: job.traceId,
          });
        }

        // Check for blocking infinite loop violations (e.g. for(;;), while(true) without exits)
        const infiniteLoopViolation = violations.find((v) => v.rule === 'INFINITE_LOOP_DETECTED');
        if (infiniteLoopViolation) {
          const fileMap = new Map(validatedFiles.map((f) => [f.path, f.content]));
          const content = fileMap.get(infiniteLoopViolation.file) || '';
          const lines = content.split(/\r?\n/);
          const lineNum = infiniteLoopViolation.line || 1;
          const colNum = infiniteLoopViolation.column || 0;
          const lineContent = lines[lineNum - 1] || '';
          const caretPad = ' '.repeat(Math.max(0, colNum));
          const nodeVer = process.version || 'v20.20.2';

          const formattedDiagnostic =
            `/workspace/${infiniteLoopViolation.file}:${lineNum}:${colNum + 1} - error CL0001: ${infiniteLoopViolation.message}\n\n` +
            `${lineNum} ${lineContent}\n  ${caretPad}^\n`;
          const fullStderr = `${formattedDiagnostic}\nNode.js ${nodeVer}\n`;

          const blockedResult: ExecutionResult = {
            jobId: job.jobId,
            status: JobStatus.COMPILATION_ERROR,
            exitCode: 1,
            stdout: '',
            stderr: fullStderr,
            htmlPreviewBundle: null,
            jsonOutput: null,
            metrics: {
              queueWaitMs,
              compileDurationMs: 0,
              executionDurationMs: 0,
              totalDurationMs: Date.now() - jobStartTime,
              peakMemoryBytes: 0,
              stdoutBytes: 0,
              stderrBytes: Buffer.byteLength(fullStderr),
              exitCode: 1,
              workerId: process.env.WORKER_ID || 'worker-01',
              sandboxId: 'blocked-ast',
            },
            errors: [
              {
                file: infiniteLoopViolation.file,
                line: lineNum,
                column: colNum + 1,
                message: infiniteLoopViolation.message,
                code: 'INFINITE_LOOP_DETECTED',
              },
            ],
            violations,
          };

          await this.emitStreamChunk(job.jobId, {
            type: 'compile_error',
            timestamp: Date.now(),
            data: formattedDiagnostic,
          });

          await this.emitStreamChunk(job.jobId, {
            type: 'stderr',
            timestamp: Date.now(),
            data: fullStderr,
          });

          await this.emitStreamChunk(job.jobId, {
            type: 'status',
            timestamp: Date.now(),
            data: { status: JobStatus.COMPILATION_ERROR },
          });

          await this.emitStreamChunk(job.jobId, {
            type: 'exit',
            timestamp: Date.now(),
            data: { exitCode: 1, status: JobStatus.COMPILATION_ERROR },
          });

          this.metricsService.recordJobCompleted(blockedResult);
          return blockedResult;
        }

        // Check for Port 3000 violation (reserved platform port)
        const port3000Violation = violations.find((v) => v.rule === 'RESERVED_PORT_3000');
        if (port3000Violation) {
          const fileMap = new Map(validatedFiles.map((f) => [f.path, f.content]));
          const content = fileMap.get(port3000Violation.file) || '';
          const lines = content.split(/\r?\n/);
          const lineNum = port3000Violation.line || 1;
          const colNum = port3000Violation.column || 0;
          const lineContent = lines[lineNum - 1] || '';
          const caretPad = ' '.repeat(Math.max(0, colNum));
          const nodeVer = process.version || 'v20.20.2';

          const formattedDiagnostic =
            `/workspace/${port3000Violation.file}:${lineNum}:${colNum + 1} - error PORT3000: ${port3000Violation.message}\n\n` +
            `${lineNum} ${lineContent}\n  ${caretPad}^\n\n` +
            `⚠️ Error [PORT_CONFLICT]: Port 3000 is strictly reserved for the Code Editor web platform.\n` +
            `Please update your server to bind to dynamic platform port or any other developer port:\n\n` +
            `  const PORT = process.env.PORT || 3001;\n` +
            `  app.listen(PORT, () => console.log(\`Server online at http://localhost:\${PORT}\`));\n\n` +
            `Any developer port (e.g., 3001, 3002, 4000, 5000, 8000, 8080) is fully supported.\n`;
          const fullStderr = `${formattedDiagnostic}\nNode.js ${nodeVer}\n`;

          const blockedResult: ExecutionResult = {
            jobId: job.jobId,
            status: JobStatus.COMPILATION_ERROR,
            exitCode: 1,
            stdout: '',
            stderr: fullStderr,
            htmlPreviewBundle: null,
            jsonOutput: null,
            metrics: {
              queueWaitMs,
              compileDurationMs: 0,
              executionDurationMs: 0,
              totalDurationMs: Date.now() - jobStartTime,
              peakMemoryBytes: 0,
              stdoutBytes: 0,
              stderrBytes: Buffer.byteLength(fullStderr),
              exitCode: 1,
              workerId: process.env.WORKER_ID || 'worker-01',
              sandboxId: 'blocked-port3000',
            },
            errors: [
              {
                file: port3000Violation.file,
                line: lineNum,
                column: colNum + 1,
                message: port3000Violation.message,
                code: 'RESERVED_PORT_3000',
              },
            ],
            violations,
          };

          await this.emitStreamChunk(job.jobId, {
            type: 'compile_error',
            timestamp: Date.now(),
            data: formattedDiagnostic,
          });

          await this.emitStreamChunk(job.jobId, {
            type: 'stderr',
            timestamp: Date.now(),
            data: fullStderr,
          });

          await this.emitStreamChunk(job.jobId, {
            type: 'status',
            timestamp: Date.now(),
            data: { status: JobStatus.COMPILATION_ERROR },
          });

          await this.emitStreamChunk(job.jobId, {
            type: 'exit',
            timestamp: Date.now(),
            data: { exitCode: 1, status: JobStatus.COMPILATION_ERROR },
          });

          this.metricsService.recordJobCompleted(blockedResult);
          DatabaseService.getInstance().recordExecution(job, blockedResult).catch(() => {});
          return blockedResult;
        }
      }

      // 3. Language Routing & Pipeline Dispatch
      const route = routeExecutionPipeline(validatedFiles, job.entryFile);
      logger.info(
        {
          jobId: job.jobId,
          entryFile: job.entryFile,
          language: route.entryLanguage,
          pipeline: route.pipeline,
          moduleFormat: route.moduleFormat,
          runtime: `node-${process.version}`,
        },
        'Language execution pipeline dispatched'
      );

      // Web Preview pipeline (.html, .css) with static diagnostic validation
      if (route.pipeline === PipelineType.WEB_PREVIEW) {
        const fileMap = new Map(validatedFiles.map((f) => [f.path, f.content]));
        const allDiagnostics: any[] = [];

        for (const f of validatedFiles) {
          if (f.path.endsWith('.html') || f.path.endsWith('.htm')) {
            const diags = validateHtmlCode(f.content, f.path);
            allDiagnostics.push(...diags);
          } else if (f.path.endsWith('.css')) {
            const diags = validateCssCode(f.content, f.path);
            allDiagnostics.push(...diags);
          }
        }

        if (allDiagnostics.length > 0) {
          const formattedBlocks: string[] = [];
          for (const diag of allDiagnostics) {
            const content = fileMap.get(diag.file) || '';
            formattedBlocks.push(formatDiagnostic(diag, content));
          }
          const fullStderr = `${formattedBlocks.join('\n')}\nHTML/CSS Compiler Diagnostic\n`;

          const blockedResult: ExecutionResult = {
            jobId: job.jobId,
            status: JobStatus.COMPILATION_ERROR,
            exitCode: 1,
            stdout: '',
            stderr: fullStderr,
            htmlPreviewBundle: null,
            jsonOutput: null,
            metrics: {
              queueWaitMs,
              compileDurationMs: 0,
              executionDurationMs: 0,
              totalDurationMs: Date.now() - jobStartTime,
              peakMemoryBytes: 0,
              stdoutBytes: 0,
              stderrBytes: Buffer.byteLength(fullStderr),
              exitCode: 1,
              workerId: process.env.WORKER_ID || 'worker-01',
              sandboxId: 'web-validator',
            },
            errors: allDiagnostics,
            violations,
          };

          for (const block of formattedBlocks) {
            await this.emitStreamChunk(job.jobId, {
              type: 'compile_error',
              timestamp: Date.now(),
              data: block,
            });
          }

          await this.emitStreamChunk(job.jobId, {
            type: 'stderr',
            timestamp: Date.now(),
            data: fullStderr,
          });

          await this.emitStreamChunk(job.jobId, {
            type: 'status',
            timestamp: Date.now(),
            data: { status: JobStatus.COMPILATION_ERROR },
          });

          await this.emitStreamChunk(job.jobId, {
            type: 'exit',
            timestamp: Date.now(),
            data: { exitCode: 1, status: JobStatus.COMPILATION_ERROR },
          });

          this.metricsService.recordJobCompleted(blockedResult);
          DatabaseService.getInstance().recordExecution(job, blockedResult).catch(() => {});
          return blockedResult;
        }

        // HTML & CSS are valid: generate preview bundle
        const previewBundle = PreviewService.generateBundle(validatedFiles, job.entryFile);
        const stdoutMsg = `[WEB_PREVIEW_PIPELINE] HTML/CSS bundle compiled successfully for ${job.entryFile}\n`;
        await this.emitStreamChunk(job.jobId, {
          type: 'stdout',
          timestamp: Date.now(),
          data: stdoutMsg,
        });

        if (previewBundle?.bundledHtml) {
          await this.emitStreamChunk(job.jobId, {
            type: 'preview',
            timestamp: Date.now(),
            data: { bundledHtml: previewBundle.bundledHtml },
          });
        }

        const result: ExecutionResult = {
          jobId: job.jobId,
          status: JobStatus.SUCCESS,
          exitCode: 0,
          stdout: stdoutMsg,
          stderr: '',
          htmlPreviewBundle: previewBundle,
          jsonOutput: null,
          metrics: {
            queueWaitMs,
            compileDurationMs: 0,
            executionDurationMs: 0,
            totalDurationMs: Date.now() - jobStartTime,
            peakMemoryBytes: 0,
            stdoutBytes: Buffer.byteLength(stdoutMsg),
            stderrBytes: 0,
            exitCode: 0,
            workerId: process.env.WORKER_ID || 'worker-01',
            sandboxId: 'preview-only',
          },
          errors: [],
          violations,
        };

        await this.emitStreamChunk(job.jobId, {
          type: 'status',
          timestamp: Date.now(),
          data: { status: JobStatus.SUCCESS },
        });

        await this.emitStreamChunk(job.jobId, {
          type: 'exit',
          timestamp: Date.now(),
          data: { exitCode: 0, status: JobStatus.SUCCESS },
        });

        this.metricsService.recordJobCompleted(result);
        DatabaseService.getInstance().recordExecution(job, result).catch(() => {});
        return result;
      }

      // EJS Template Render pipeline (.ejs)
      if (route.pipeline === PipelineType.EJS_RENDER || job.entryFile.endsWith('.ejs')) {
        const fileMap = new Map(validatedFiles.map((f) => [f.path, f.content]));
        const ejsContent = fileMap.get(job.entryFile) || '';

        // 1. Static validation for EJS syntax & unclosed delimiters
        const ejsDiagnostics = validateEjsCode(ejsContent, job.entryFile);
        if (ejsDiagnostics.length > 0) {
          const formattedBlocks: string[] = [];
          for (const diag of ejsDiagnostics) {
            formattedBlocks.push(formatDiagnostic(diag, ejsContent));
          }
          const fullStderr = `${formattedBlocks.join('\n')}\nEJS Template Syntax Error\n`;

          const blockedResult: ExecutionResult = {
            jobId: job.jobId,
            status: JobStatus.COMPILATION_ERROR,
            exitCode: 1,
            stdout: '',
            stderr: fullStderr,
            htmlPreviewBundle: null,
            jsonOutput: null,
            metrics: {
              queueWaitMs,
              compileDurationMs: 0,
              executionDurationMs: 0,
              totalDurationMs: Date.now() - jobStartTime,
              peakMemoryBytes: 0,
              stdoutBytes: 0,
              stderrBytes: Buffer.byteLength(fullStderr),
              exitCode: 1,
              workerId: process.env.WORKER_ID || 'worker-01',
              sandboxId: 'ejs-validator',
            },
            errors: ejsDiagnostics,
            violations,
          };

          for (const block of formattedBlocks) {
            await this.emitStreamChunk(job.jobId, {
              type: 'compile_error',
              timestamp: Date.now(),
              data: block,
            });
          }

          await this.emitStreamChunk(job.jobId, {
            type: 'stderr',
            timestamp: Date.now(),
            data: fullStderr,
          });

          await this.emitStreamChunk(job.jobId, {
            type: 'status',
            timestamp: Date.now(),
            data: { status: JobStatus.COMPILATION_ERROR },
          });

          await this.emitStreamChunk(job.jobId, {
            type: 'exit',
            timestamp: Date.now(),
            data: { exitCode: 1, status: JobStatus.COMPILATION_ERROR },
          });

          this.metricsService.recordJobCompleted(blockedResult);
          DatabaseService.getInstance().recordExecution(job, blockedResult).catch(() => {});
          return blockedResult;
        }

        // 2. Render EJS template with data context
        let renderedHtml = '';
        try {
          const mockData = {
            title: 'Node.js Compiler Platform',
            message: 'EJS Server-Side Rendering Active',
            heading: 'Universal Node.js IDE',
            user: { name: 'Developer', role: 'admin', email: 'dev@example.com' },
            items: ['Express REST API', 'EJS Engine', 'React/JSX Support', 'HTML & CSS Preview'],
            timestamp: new Date().toISOString(),
          };
          renderedHtml = ejs.render(ejsContent, mockData, {
            filename: job.entryFile,
            async: false,
          });
        } catch (ejsErr: any) {
          const errMsg = ejsErr.message || String(ejsErr);
          const lineMatch = errMsg.match(/(?:>>|line)\s*(\d+)/i);
          const errLine = lineMatch ? parseInt(lineMatch[1], 10) : 1;
          const lines = ejsContent.split(/\r?\n/);
          const lineContent = lines[errLine - 1] || '';
          const formattedErr =
            `/workspace/${job.entryFile}:${errLine}:1 - error EJS_RENDER: ${errMsg}\n\n` +
            `${errLine} ${lineContent}\n  ^\n`;

          const failureResult: ExecutionResult = {
            jobId: job.jobId,
            status: JobStatus.RUNTIME_ERROR,
            exitCode: 1,
            stdout: '',
            stderr: formattedErr,
            htmlPreviewBundle: null,
            jsonOutput: null,
            metrics: {
              queueWaitMs,
              compileDurationMs: 0,
              executionDurationMs: 0,
              totalDurationMs: Date.now() - jobStartTime,
              peakMemoryBytes: 0,
              stdoutBytes: 0,
              stderrBytes: Buffer.byteLength(formattedErr),
              exitCode: 1,
              workerId: process.env.WORKER_ID || 'worker-01',
              sandboxId: 'ejs-runtime',
            },
            errors: [{ file: job.entryFile, line: errLine, column: 1, message: errMsg, code: 'EJS_RENDER' }],
            violations,
          };

          await this.emitStreamChunk(job.jobId, {
            type: 'runtime_error',
            timestamp: Date.now(),
            data: { message: formattedErr },
          });

          await this.emitStreamChunk(job.jobId, {
            type: 'stderr',
            timestamp: Date.now(),
            data: formattedErr,
          });

          await this.emitStreamChunk(job.jobId, {
            type: 'status',
            timestamp: Date.now(),
            data: { status: JobStatus.RUNTIME_ERROR },
          });

          await this.emitStreamChunk(job.jobId, {
            type: 'exit',
            timestamp: Date.now(),
            data: { exitCode: 1, status: JobStatus.RUNTIME_ERROR },
          });

          this.metricsService.recordJobCompleted(failureResult);
          DatabaseService.getInstance().recordExecution(job, failureResult).catch(() => {});
          return failureResult;
        }

        // Render succeeded: stream stdout and preview bundle
        const stdoutMsg =
          `[EJS_RENDER_PIPELINE] Template ${job.entryFile} compiled and rendered successfully.\n` +
          `--- Rendered Output (${Buffer.byteLength(renderedHtml, 'utf8')} bytes) ---\n` +
          `${renderedHtml}\n` +
          `--------------------------------------------------\n`;

        await this.emitStreamChunk(job.jobId, {
          type: 'stdout',
          timestamp: Date.now(),
          data: stdoutMsg,
        });

        const previewBundle = PreviewService.generateBundle(
          [...validatedFiles.filter((f) => f.path !== 'index.html'), { path: 'index.html', content: renderedHtml, type: 'html' }],
          'index.html'
        );

        if (previewBundle?.bundledHtml) {
          await this.emitStreamChunk(job.jobId, {
            type: 'preview',
            timestamp: Date.now(),
            data: { bundledHtml: previewBundle.bundledHtml },
          });
        }

        const result: ExecutionResult = {
          jobId: job.jobId,
          status: JobStatus.SUCCESS,
          exitCode: 0,
          stdout: stdoutMsg,
          stderr: '',
          htmlPreviewBundle: previewBundle,
          jsonOutput: null,
          metrics: {
            queueWaitMs,
            compileDurationMs: 0,
            executionDurationMs: 0,
            totalDurationMs: Date.now() - jobStartTime,
            peakMemoryBytes: 0,
            stdoutBytes: Buffer.byteLength(stdoutMsg),
            stderrBytes: 0,
            exitCode: 0,
            workerId: process.env.WORKER_ID || 'worker-01',
            sandboxId: 'ejs-render',
          },
          errors: [],
          violations,
        };

        await this.emitStreamChunk(job.jobId, {
          type: 'status',
          timestamp: Date.now(),
          data: { status: JobStatus.SUCCESS },
        });

        await this.emitStreamChunk(job.jobId, {
          type: 'exit',
          timestamp: Date.now(),
          data: { exitCode: 0, status: JobStatus.SUCCESS },
        });

        this.metricsService.recordJobCompleted(result);
        DatabaseService.getInstance().recordExecution(job, result).catch(() => {});
        return result;
      }

      let filesToMaterialize = validatedFiles;
      let targetEntryFile = job.entryFile;

      // 4. Compile TypeScript / JSX ONLY if route requires compilation
      if (route.requiresCompilation) {
        const compileStart = Date.now();
        const compilation = compileTypeScriptProject(validatedFiles, job.entryFile);
        compileDurationMs = Date.now() - compileStart;

        if (!compilation.success) {
          const fileMap = new Map(validatedFiles.map((f) => [f.path, f.content]));
          const formattedBlocks: string[] = [];
          for (const err of compilation.errors) {
            const content = fileMap.get(err.file) || '';
            const lines = content.split(/\r?\n/);
            const lineContent = lines[err.line - 1] || '';
            const caretPad = ' '.repeat(Math.max(0, err.column - 1));
            formattedBlocks.push(
              `/workspace/${err.file}:${err.line}:${err.column} - error TS${err.code || ''}: ${err.message}\n\n${err.line} ${lineContent}\n  ${caretPad}^\n`
            );
          }
          const nodeVer = process.version || 'v20.20.2';
          const fullStderr = `${formattedBlocks.join('\n')}\nNode.js ${nodeVer}\n`;

          const result: ExecutionResult = {
            jobId: job.jobId,
            status: JobStatus.COMPILATION_ERROR,
            exitCode: 1,
            stdout: '',
            stderr: fullStderr,
            htmlPreviewBundle: null,
            jsonOutput: null,
            metrics: {
              queueWaitMs,
              compileDurationMs,
              executionDurationMs: 0,
              totalDurationMs: Date.now() - jobStartTime,
              peakMemoryBytes: 0,
              stdoutBytes: 0,
              stderrBytes: Buffer.byteLength(fullStderr),
              exitCode: 1,
              workerId: process.env.WORKER_ID || 'worker-01',
              sandboxId: 'none',
            },
            errors: compilation.errors,
            violations,
          };

          for (const block of formattedBlocks) {
            await this.emitStreamChunk(job.jobId, {
              type: 'stderr',
              timestamp: Date.now(),
              data: block,
            });
          }
          await this.emitStreamChunk(job.jobId, {
            type: 'stderr',
            timestamp: Date.now(),
            data: `\nNode.js ${nodeVer}\n`,
          });

          await this.emitStreamChunk(job.jobId, {
            type: 'status',
            timestamp: Date.now(),
            data: { status: JobStatus.COMPILATION_ERROR },
          });

          await this.emitStreamChunk(job.jobId, {
            type: 'exit',
            timestamp: Date.now(),
            data: { exitCode: 1, status: JobStatus.COMPILATION_ERROR },
          });

          this.metricsService.recordJobCompleted(result);
          DatabaseService.getInstance().recordExecution(job, result).catch(() => {});
          return result;
        }

        filesToMaterialize = compilation.files;
        targetEntryFile = compilation.compiledEntryFile;
      }

      // 5. Create sandbox workspace
      sandbox = await this.sandboxRuntime.create(job);
      ExecutionProcessor.activeSandboxes.set(job.jobId, {
        sandbox,
        runtime: this.sandboxRuntime,
        projectId: job.projectId,
        userId: job.userId,
      });

      // 6. Materialize files onto the isolated filesystem
      for (const file of filesToMaterialize) {
        const filePath = path.join(sandbox.workspaceDir, file.path);
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, file.content, 'utf8');
      }

      // Materialize DOM & innerHTML shim in sandbox workspace
      const domShimFilePath = path.join(sandbox.workspaceDir, '_dom_shim.js');
      await fs.writeFile(domShimFilePath, DOM_SHIM_SOURCE, 'utf8');

      // Link node_modules so user code can access installed packages
      const hostNodeModules = path.resolve(process.cwd(), 'node_modules');
      const sandboxNodeModules = path.join(sandbox.workspaceDir, 'node_modules');
      try {
        await fs.symlink(hostNodeModules, sandboxNodeModules, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (linkErr) {
        // Ignored if link already exists or permission denied
      }

      // Discover and stream declared REST endpoints and listening port from user code
      const endpointScan = scanProjectEndpoints(validatedFiles, job.entryFile);
      if (endpointScan.endpoints.length > 0 || endpointScan.detectedPort) {
        await this.emitStreamChunk(job.jobId, {
          type: 'endpoints',
          timestamp: Date.now(),
          data: endpointScan as any,
        });
      }

      // Configure package.json matching the module system
      const hasExplicitPackageJson = filesToMaterialize.some((f) => f.path === 'package.json');
      if (!hasExplicitPackageJson) {
        const generatedPackageJson = {
          name: 'sandbox-project',
          version: '1.0.0',
          type: route.moduleFormat,
          main: targetEntryFile,
        };
        await fs.writeFile(
          path.join(sandbox.workspaceDir, 'package.json'),
          JSON.stringify(generatedPackageJson, null, 2),
          'utf8'
        );
      }

      // Helper to map host sandbox paths into standard /workspace paths
      const normalizeOutput = (text: string): string => {
        if (!text || typeof text !== 'string') return '';
        let cleaned = text;

        if (sandbox && sandbox.workspaceDir) {
          const rawDir = sandbox.workspaceDir;
          const escapedForRegex = rawDir.replace(/[.*+?^${}()|[\]\\]/g, (match) => {
            if (match === '\\') return '[\\\\/]+';
            return '\\' + match;
          });
          cleaned = cleaned.replace(new RegExp(escapedForRegex, 'gi'), '/workspace');
        }

        // Catch any residual ide-sandboxes or ide-process-sandboxes paths on Windows or Linux
        cleaned = cleaned.replace(/[a-zA-Z]:[\\/][^'"`\r\n]*?ide-(?:process-)?sandboxes[\\/][^'"`\r\n\\/]+/gi, '/workspace');
        cleaned = cleaned.replace(/\/tmp\/ide-(?:process-)?sandboxes\/[^'"`\r\n\\/]+/gi, '/workspace');

        // Convert any /workspace\ or /workspace\\ into /workspace/
        cleaned = cleaned.replace(/\/workspace[\\/]+/g, '/workspace/');
        cleaned = cleaned.replace(/\\workspace[\\/]+/g, '/workspace/');

        // Remove docker container pull logs if any
        cleaned = cleaned
          .replace(/Unable to find image[^\n]*\n?/g, '')
          .replace(/.*Pulling from library\/node[^\n]*\n?/g, '')
          .replace(/.*Digest: sha256:[^\n]*\n?/g, '')
          .replace(/.*Status: Downloaded newer image[^\n]*\n?/g, '');

        return cleaned;
      };

      // 6. Execute inside sandbox with real-time stream publishing
      const onChunkCallback = (chunk: StreamChunk) => {
        if (typeof chunk.data === 'string') {
          chunk.data = normalizeOutput(chunk.data);
        }
        this.emitStreamChunk(job.jobId, chunk).catch(() => {});
      };

      const usesDom = filesToMaterialize.some((f) =>
        /(?:innerHTML|document\.|window\.|createElement|getElementById)/i.test(f.content)
      );
      const nodeCommand = usesDom
        ? ['node', '-r', './_dom_shim.js', targetEntryFile]
        : ['node', targetEntryFile];

      let rawResult = await this.circuitBreaker.execute(async () => {
        let res = await this.sandboxRuntime.execute(
          sandbox!,
          nodeCommand,
          job.limits,
          onChunkCallback
        );

        // If docker had a daemon, image, or workspace mounting issue, fall back to native process sandbox
        if (res.stderr && (
          res.stderr.includes('docker: Error response from daemon') ||
          res.stderr.includes('Cannot connect to the Docker daemon') ||
          res.stderr.includes(`Cannot find module '/workspace/${targetEntryFile}'`) ||
          res.stderr.includes(`Cannot find module '${sandbox?.workspaceDir}/${targetEntryFile}'`) ||
          res.stderr.includes('Cannot find module \'/workspace/')
        )) {
          logger.warn({ jobId: job.jobId }, 'Docker sandbox workspace mount unavailable - falling back to ProcessSandboxRuntime');
          const processRuntime = new ProcessSandboxRuntime();
          res = await processRuntime.execute(
            sandbox!,
            nodeCommand,
            job.limits,
            onChunkCallback
          );
        }
        return res;
      });

      // Real-time Alerting: Distinguish true platform/sandbox crashes (OOM, segfault, internal error)
      // from normal user script runtime exceptions (exitCode: 1, e.g. ReferenceError, SyntaxError)
      const isOOM = rawResult.exitCode === 137 || rawResult.stderr.includes('JavaScript heap out of memory');
      const isSegfault = rawResult.exitCode === 139;
      const isPlatformCrash = rawResult.status === JobStatus.SYSTEM_ERROR || isOOM || isSegfault;

      if (rawResult.status === JobStatus.TIMEOUT) {
        const timeoutAlert = this.alertService.recordTimeout(job.jobId, job.limits.timeoutMs, job.traceId);
        await this.emitStreamChunk(job.jobId, {
          type: 'alert',
          timestamp: Date.now(),
          data: timeoutAlert,
        });
      } else if (isPlatformCrash) {
        const crashReason = isOOM
          ? 'Process killed: Memory limit exceeded (OOM)'
          : isSegfault
          ? 'Process terminated by Segmentation Fault (SIGSEGV)'
          : (rawResult.stderr.split('\n')[0] || 'Internal sandbox execution fault').trim();

        const crashAlert = this.alertService.recordCrash(
          job.jobId,
          job.traceId,
          crashReason,
          { exitCode: rawResult.exitCode, status: rawResult.status, isOOM, isSegfault }
        );
        await this.emitStreamChunk(job.jobId, {
          type: 'alert',
          timestamp: Date.now(),
          data: crashAlert,
        });
      }

      const totalDurationMs = Date.now() - jobStartTime;

      let enrichedStderr = normalizeOutput(rawResult.stderr);
      const extraFeedback = this.enrichErrorFeedback(rawResult, job.limits);
      if (extraFeedback) {
        enrichedStderr += extraFeedback;
        await this.emitStreamChunk(job.jobId, {
          type: 'stderr',
          timestamp: Date.now(),
          data: extraFeedback,
        });
      }

      // Detect Port 3000 conflict (reserved by Code Editor platform)
      if (
        (enrichedStderr.includes('EADDRINUSE') || enrichedStderr.includes('address already in use')) &&
        (enrichedStderr.includes('3000') || enrichedStderr.includes(':::3000') || enrichedStderr.includes('0.0.0.0:3000') || enrichedStderr.includes('127.0.0.1:3000'))
      ) {
        const portNotice =
          `\n⚠️ Error [PORT_CONFLICT]: Port 3000 is strictly reserved for the Code Editor web platform.\n` +
          `Please update your server to bind to the dynamic platform port:\n\n` +
          `  const PORT = process.env.PORT || 3001;\n` +
          `  app.listen(PORT, () => console.log('Server online'));\n\n` +
          `Any developer port (e.g., 3001, 3002, 4000, 5000, 8080) is fully supported.\n`;
        enrichedStderr = `${portNotice}\n${enrichedStderr}`;
        await this.emitStreamChunk(job.jobId, {
          type: 'stderr',
          timestamp: Date.now(),
          data: portNotice,
        });
      } else if (enrichedStderr.includes('EADDRINUSE') || enrichedStderr.includes('address already in use')) {
        const portMatch = enrichedStderr.match(/(?:port|:::)\s*(\d{4,5})/i);
        const conflictPort = portMatch ? portMatch[1] : 'the specified port';
        const portNotice =
          `\n⚠️ Error [EADDRINUSE]: Port ${conflictPort} is occupied by an active background server.\n` +
          `💡 Quick Fixes:\n` +
          `  • Click "Stop" in the top bar to terminate any running server before re-running.\n` +
          `  • Use the IDE's managed port in your code:\n` +
          `      const PORT = process.env.PORT || 3001;\n` +
          `      app.listen(PORT, () => console.log('Server online'));\n`;
        enrichedStderr = `${portNotice}\n${enrichedStderr}`;
        await this.emitStreamChunk(job.jobId, {
          type: 'stderr',
          timestamp: Date.now(),
          data: portNotice,
        });
      }

      // Ensure authentic Node.js error trace formatting including version footer
      if (rawResult.exitCode !== 0 && enrichedStderr.trim().length > 0 && !enrichedStderr.includes('Node.js v')) {
        const nodeVer = process.version || 'v20.20.2';
        const versionFooter = `\n\nNode.js ${nodeVer}\n`;
        enrichedStderr = `${enrichedStderr.trimEnd()}${versionFooter}`;
        await this.emitStreamChunk(job.jobId, {
          type: 'stderr',
          timestamp: Date.now(),
          data: versionFooter,
        });
      }

      let htmlPreviewBundle: any = null;
      if (
        validatedFiles.some((f) => /\.(html|htm|jsx|tsx|ejs)$/i.test(f.path)) ||
        validatedFiles.some((f) => /(?:innerHTML|document\.|window\.)/i.test(f.content)) ||
        route.entryLanguage === LanguageType.JSX ||
        route.entryLanguage === LanguageType.TSX
      ) {
        try {
          htmlPreviewBundle = PreviewService.generateBundle(validatedFiles, 'index.html');
          if (htmlPreviewBundle?.bundledHtml) {
            await this.emitStreamChunk(job.jobId, {
              type: 'preview',
              timestamp: Date.now(),
              data: { bundledHtml: htmlPreviewBundle.bundledHtml },
            });
          }
        } catch {}
      }

      const finalResult: ExecutionResult = {
        ...rawResult,
        stdout: normalizeOutput(rawResult.stdout),
        stderr: enrichedStderr,
        htmlPreviewBundle,
        errors: [],
        violations,
        metrics: {
          ...rawResult.metrics,
          queueWaitMs,
          compileDurationMs,
          totalDurationMs,
        },
      };

      // Emit completion events
      await this.emitStreamChunk(job.jobId, {
        type: 'metrics',
        timestamp: Date.now(),
        data: finalResult.metrics,
      });

      await this.emitStreamChunk(job.jobId, {
        type: 'exit',
        timestamp: Date.now(),
        data: { exitCode: finalResult.exitCode, status: finalResult.status },
      });

      this.metricsService.recordJobCompleted(finalResult);
      DatabaseService.getInstance().recordExecution(job, finalResult).catch(() => {});
      return finalResult;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ jobId: job.jobId, err }, 'Execution processor error');

      const crashAlert = this.alertService.recordCrash(job.jobId, job.traceId, errorMessage);
      await this.emitStreamChunk(job.jobId, {
        type: 'alert',
        timestamp: Date.now(),
        data: crashAlert,
      });

      const failureResult: ExecutionResult = {
        jobId: job.jobId,
        status: JobStatus.SYSTEM_ERROR,
        exitCode: 1,
        stdout: '',
        stderr: `Execution System Error: ${errorMessage}`,
        htmlPreviewBundle: null,
        jsonOutput: null,
        metrics: {
          queueWaitMs,
          compileDurationMs,
          executionDurationMs: 0,
          totalDurationMs: Date.now() - jobStartTime,
          peakMemoryBytes: 0,
          stdoutBytes: 0,
          stderrBytes: 0,
          exitCode: 1,
          workerId: process.env.WORKER_ID || 'worker-01',
          sandboxId: sandbox ? sandbox.id : 'unknown',
        },
        errors: [],
        violations: [],
      };

      await this.emitStreamChunk(job.jobId, {
        type: 'runtime_error',
        timestamp: Date.now(),
        data: { message: errorMessage },
      });

      await this.emitStreamChunk(job.jobId, {
        type: 'status',
        timestamp: Date.now(),
        data: { status: JobStatus.SYSTEM_ERROR },
      });

      this.metricsService.recordJobCompleted(failureResult);
      DatabaseService.getInstance().recordExecution(job, failureResult).catch(() => {});
      return failureResult;
    } finally {
      // 7. Remove from active sandboxes registry
      ExecutionProcessor.activeSandboxes.delete(job.jobId);

      // 8. Always cleanly destroy the sandbox and wipe ephemeral files
      if (sandbox) {
        try {
          await this.sandboxRuntime.destroy(sandbox);
        } catch (cleanupErr) {
          logger.warn({ sandboxId: sandbox.id, cleanupErr }, 'Failed to cleanly destroy sandbox');
        }
      }
    }
  }

  private async emitStreamChunk(jobId: string, chunk: StreamChunk): Promise<void> {
    try {
      await this.streamService.publishChunk(jobId, chunk);
    } catch (err) {
      logger.debug({ jobId, err }, 'Failed to emit stream chunk');
    }
  }

  private enrichErrorFeedback(result: { status: JobStatus; stderr: string }, limits: ExecutionLimits): string {
    if (result.status === JobStatus.TIMEOUT) {
      const nodeVer = process.version || 'v20.20.2';
      return `\nError [ETIMEDOUT]: Execution timed out after ${limits.timeoutMs}ms (Process terminated)\n\nNode.js ${nodeVer}\n`;
    }
    if (result.stderr.includes('Cannot find module') || result.stderr.includes('ERR_MODULE_NOT_FOUND')) {
      const modMatch = result.stderr.match(/Cannot find module ['"]([^'"]+)['"]/);
      const modName = modMatch ? modMatch[1] : 'the requested module';
      return (
        `\n💡 Package Resolution Hint: Module "${modName}" is not found.\n` +
        `   Available installed packages: express, ejs, axios, cors, helmet, lodash, dayjs, uuid, dotenv, bcryptjs, jsonwebtoken, zod, body-parser, cookie-parser, react, react-dom.\n`
      );
    }
    return '';
  }
}
