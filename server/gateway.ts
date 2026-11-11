/**
 * Stateless API Gateway
 * Handles HTTP requests, authentication hooks, rate limiting, request validation,
 * job submission, SSE output streaming, preview bundles, and health probes.
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import axios from 'axios';
import { ZodError } from 'zod';
import {
  executionRequestSchema,
  previewRequestSchema,
  cancelJobSchema,
  proxyRequestSchema,
  detectEndpointsSchema,
} from './validation/executionSchema';
import { FileValidationError, validateProjectFiles } from './validation/fileValidation';
import { scanProjectEndpoints } from './validation/endpointScanner';
import { JobService } from './services/jobService';
import { StreamService } from './services/streamService';
import { PreviewService } from './services/previewService';
import { MetricsService } from './services/metricsService';
import { AlertService } from './services/alertService';
import { DatabaseService } from './database/databaseService';
import { validateSsrfTarget } from './security/ssrfGuard';
import { distributedRateLimiter } from './security/distributedRateLimiter';
import { authAndCorrelationMiddleware } from './security/authAndCorrelation';
import { SYSTEM_LIMITS } from './utils/limits';
import { logger } from './utils/logger';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

export interface CompilerRouterOptions {
  authMiddleware?: express.RequestHandler;
}

export function createCompilerRouter(options?: CompilerRouterOptions): express.Router {
  const router = express.Router();
  const jobService = JobService.getInstance();
  const streamService = StreamService.getInstance();
  const metricsService = MetricsService.getInstance();
  const alertService = AlertService.getInstance();

  const authHook = options?.authMiddleware || ((_req, _res, next) => next());

  /**
   * POST /api/v1/jobs - Submit a code execution request
   */
  router.post('/api/v1/jobs', distributedRateLimiter, authHook, async (req: Request, res: Response) => {
    try {
      const parsedBody = executionRequestSchema.parse(req.body);
      const validatedFiles = validateProjectFiles(parsedBody.files, parsedBody.entryFile);

      const userId = (req as any).userId || (req.headers['x-user-id'] as string) || req.ip || 'anonymous';
      const traceId = (req as any).traceId || (req.headers['x-trace-id'] as string) || `trace-${Date.now()}`;

      const submission = await jobService.submitJob(
        {
          projectId: parsedBody.projectId,
          entryFile: parsedBody.entryFile,
          files: validatedFiles,
          options: parsedBody.options,
        },
        userId,
        traceId
      );

      logger.info({ jobId: submission.jobId, userId, traceId }, 'Execution job submitted successfully');

      return res.status(202).json({
        jobId: submission.jobId,
        status: submission.status,
        streamUrl: `/api/v1/jobs/${submission.jobId}/stream`,
        statusUrl: `/api/v1/jobs/${submission.jobId}`,
      });
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid request payload structure.',
          details: err.errors,
        });
      }
      if (err instanceof FileValidationError) {
        return res.status(400).json({
          error: 'File Validation Error',
          code: err.code,
          message: err.message,
          details: err.details,
        });
      }
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('concurrency limit reached')) {
        return res.status(429).json({ error: 'Concurrency Limit Exceeded', message });
      }
      logger.error({ err }, 'Unhandled error submitting job');
      return res.status(500).json({ error: 'Internal Server Error', message });
    }
  });

  /**
   * GET /api/v1/jobs/:jobId - Get job status and result
   */
  router.get('/api/v1/jobs/:jobId', async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const jobRecord = await jobService.getJob(jobId);

    if (!jobRecord) {
      return res.status(404).json({ error: 'Not Found', message: `Job ${jobId} was not found.` });
    }

    return res.status(200).json(jobRecord);
  });

  /**
   * POST /api/v1/jobs/:jobId/cancel - Cancel active or queued job
   */
  router.post('/api/v1/jobs/:jobId/cancel', async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      cancelJobSchema.parse(req.body || {});
      const result = await jobService.cancelJob(jobId);
      return res.status(200).json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ error: 'Cancellation Failed', message });
    }
  });

  /**
   * GET /api/v1/jobs/:jobId/stream - Server-Sent Events (SSE) live streaming
   */
  router.get('/api/v1/jobs/:jobId/stream', async (req: Request, res: Response) => {
    const { jobId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Replay any buffered historical chunks first (for reconnecting clients)
    try {
      const replayChunks = await streamService.getReplayChunks(jobId);
      for (const chunk of replayChunks) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    } catch (err) {
      logger.debug({ jobId, err }, 'Failed to replay past chunks');
    }

    const unsubscribe = streamService.subscribeToJob(jobId, (chunk) => {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      if (chunk.type === 'exit' || (chunk.type === 'status' && chunk.data && (chunk.data as any).status === 'COMPILATION_ERROR')) {
        setTimeout(() => {
          res.end();
        }, 500);
      }
    });

    const pingInterval = setInterval(() => {
      res.write(`: ping ${Date.now()}\n\n`);
    }, 15000);

    req.on('close', () => {
      clearInterval(pingInterval);
      unsubscribe();
    });
  });

  /**
   * POST /api/v1/preview - Generate sandboxed HTML preview bundle
   */
  router.post('/api/v1/preview', (req: Request, res: Response) => {
    try {
      const parsedBody = previewRequestSchema.parse(req.body);
      const targetEntry = (parsedBody.entryHtml && parsedBody.files.some((f) => f.path === parsedBody.entryHtml))
        ? parsedBody.entryHtml
        : (parsedBody.files.find((f) => f.path.endsWith('.html') || f.path.endsWith('.htm') || f.path.endsWith('.ejs'))?.path || parsedBody.files[0]?.path || 'index.html');
      const validatedFiles = validateProjectFiles(parsedBody.files, targetEntry);
      const bundle = PreviewService.generateBundle(
        validatedFiles,
        targetEntry,
        parsedBody.activeServerPort
      );
      return res.status(200).json(bundle);
    } catch (err: unknown) {
      if (err instanceof ZodError || err instanceof FileValidationError) {
        return res.status(400).json({
          error: 'Preview Generation Error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return res.status(500).json({ error: 'Internal Server Error', message: String(err) });
    }
  });

  /**
   * GET /api/v1/metrics - Real-time system and execution metrics
   */
  router.get('/api/v1/metrics', async (_req: Request, res: Response) => {
    const platformMetrics = metricsService.getSummary();
    const queueMetrics = await jobService.getQueueMetrics();
    return res.status(200).json({
      platform: platformMetrics,
      queue: queueMetrics,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /healthz and /health - Liveness probe
   */
  const healthHandler = (_req: Request, res: Response) => {
    return res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  };
  router.get('/healthz', healthHandler);
  router.get('/health', healthHandler);
  router.get('/api/health', healthHandler);

  /**
   * GET /readyz and /ready - Readiness probe
   */
  const readyHandler = async (_req: Request, res: Response) => {
    const queueMetrics = await jobService.getQueueMetrics();
    const alerts = alertService.getRecentAlerts(10);
    const criticalCount = alerts.filter((a) => a.severity === 'CRITICAL').length;

    return res.status(200).json({
      ready: true,
      services: {
        api: 'healthy',
        queue: 'operational',
        workerConcurrency: queueMetrics.workerConcurrency,
        activeJobs: queueMetrics.activeCount,
        waitingJobs: queueMetrics.waitingCount,
        memoryAvailableBytes: process.memoryUsage().heapTotal,
        memoryUsedBytes: process.memoryUsage().heapUsed,
      },
      alerts: {
        recentCount: alerts.length,
        criticalCount,
        status: criticalCount > 0 ? 'ATTENTION' : 'NOMINAL',
      },
      timestamp: new Date().toISOString(),
    });
  };
  router.get('/readyz', readyHandler);
  router.get('/ready', readyHandler);

  /**
   * GET /metrics - Prometheus exposition format (text/plain; version=0.0.4)
   */
  router.get('/metrics', async (_req: Request, res: Response) => {
    const platform = metricsService.getSummary();
    const queue = await jobService.getQueueMetrics();
    const dbMetrics = DatabaseService.getInstance().getMetrics();
    const mem = process.memoryUsage();

    const lines = [
      '# HELP ide_uptime_seconds Total server uptime in seconds',
      '# TYPE ide_uptime_seconds gauge',
      `ide_uptime_seconds ${process.uptime()}`,
      '',
      '# HELP ide_memory_heap_used_bytes Process heap memory used in bytes',
      '# TYPE ide_memory_heap_used_bytes gauge',
      `ide_memory_heap_used_bytes ${mem.heapUsed}`,
      '',
      '# HELP ide_memory_heap_total_bytes Process heap memory allocated in bytes',
      '# TYPE ide_memory_heap_total_bytes gauge',
      `ide_memory_heap_total_bytes ${mem.heapTotal}`,
      '',
      '# HELP ide_executions_total Total jobs submitted since startup',
      '# TYPE ide_executions_total counter',
      `ide_executions_total ${platform.totalJobs || 0}`,
      '',
      '# HELP ide_executions_successful Total successful executions',
      '# TYPE ide_executions_successful counter',
      `ide_executions_successful ${platform.statusBreakdown?.SUCCESS || 0}`,
      '',
      '# HELP ide_executions_failed Total failed executions',
      '# TYPE ide_executions_failed counter',
      `ide_executions_failed ${(platform.statusBreakdown?.SYSTEM_ERROR || 0) + (platform.statusBreakdown?.COMPILATION_ERROR || 0)}`,
      '',
      '# HELP ide_queue_waiting_jobs Number of waiting jobs in execution queue',
      '# TYPE ide_queue_waiting_jobs gauge',
      `ide_queue_waiting_jobs ${queue.waitingCount}`,
      '',
      '# HELP ide_queue_active_jobs Number of currently executing jobs',
      '# TYPE ide_queue_active_jobs gauge',
      `ide_queue_active_jobs ${queue.activeCount}`,
      '',
      '# HELP ide_worker_concurrency Worker slot capacity',
      '# TYPE ide_worker_concurrency gauge',
      `ide_worker_concurrency ${queue.workerConcurrency}`,
      '',
      '# HELP ide_execution_duration_p50_ms 50th percentile execution duration',
      '# TYPE ide_execution_duration_p50_ms gauge',
      `ide_execution_duration_p50_ms ${dbMetrics.durationPercentiles.p50 || 0}`,
      '',
      '# HELP ide_execution_duration_p95_ms 95th percentile execution duration',
      '# TYPE ide_execution_duration_p95_ms gauge',
      `ide_execution_duration_p95_ms ${dbMetrics.durationPercentiles.p95 || 0}`,
      '',
      '# HELP ide_execution_duration_p99_ms 99th percentile execution duration',
      '# TYPE ide_execution_duration_p99_ms gauge',
      `ide_execution_duration_p99_ms ${dbMetrics.durationPercentiles.p99 || 0}`,
      '',
    ];

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return res.status(200).send(lines.join('\n'));
  });

  /**
   * GET /api/v1/alerts - Query system & crash alerts
   */
  router.get('/api/v1/alerts', (req: Request, res: Response) => {
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const alerts = alertService.getRecentAlerts(limit);
    return res.status(200).json({
      alerts,
      count: alerts.length,
      timestamp: new Date().toISOString(),
      healthStatus: alerts.some((a) => a.severity === 'CRITICAL') ? 'DEGRADED_INCIDENTS' : 'HEALTHY',
    });
  });

  /**
   * GET /api/v1/alerts/stream - Real-time SSE alert event stream
   */
  router.get('/api/v1/alerts/stream', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const unsubscribe = alertService.subscribe((alert) => {
      res.write(`data: ${JSON.stringify(alert)}\n\n`);
    });

    const pingInterval = setInterval(() => {
      res.write(`: alert-ping ${Date.now()}\n\n`);
    }, 15000);

    _req.on('close', () => {
      clearInterval(pingInterval);
      unsubscribe();
    });
  });

  /**
   * POST /api/v1/proxy-request - Secure, validated API testing proxy for Thunder Client
   */
  router.post('/api/v1/proxy-request', async (req: Request, res: Response) => {
    try {
      // 1. Validate payload structure using strict Zod schema
      const parsedRequest = proxyRequestSchema.parse(req.body);
      let { url, method, headers, body } = parsedRequest;
      const normalizedMethod = String(method).toUpperCase();

      // Dynamic relative URL resolution (e.g. /api/users -> http://localhost:<port>/api/users)
      if (url.startsWith('/')) {
        const targetPort = (req.headers['x-target-port'] as string) || '3001';
        url = `http://localhost:${targetPort}${url}`;
      }

      // 2. Validate URL Format & Protocol
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return res.status(400).json({
          error: 'Invalid URL',
          message: 'The provided URL is not a valid absolute URL (e.g. http://localhost:3001/api/tickets).',
        });
      }

      const protocol = parsedUrl.protocol.toLowerCase();
      if (protocol !== 'http:' && protocol !== 'https:') {
        return res.status(400).json({
          error: 'Validation Error',
          message: `Unsupported protocol "${parsedUrl.protocol}". Only http:// and https:// are supported.`,
        });
      }

      // 3. Validate Port Range (1 to 65535)
      let effectivePort: number;
      if (parsedUrl.port) {
        effectivePort = parseInt(parsedUrl.port, 10);
      } else {
        effectivePort = protocol === 'https:' ? 443 : 80;
      }

      if (parsedUrl.port === '0' || effectivePort === 0) {
        return res.status(400).json({
          error: 'Validation Error',
          message: `Port "${parsedUrl.port}" is out of range. TCP ports must be between 1 and 65535.`,
        });
      }

      if (isNaN(effectivePort) || effectivePort < 1 || effectivePort > 65535) {
        return res.status(400).json({
          error: 'Invalid URL',
          message: `Port "${parsedUrl.port}" is out of range. TCP ports must be between 1 and 65535.`,
        });
      }

      // 4. Comprehensive SSRF, DNS Rebinding & Cloud Metadata Guard
      const ssrfCheck = await validateSsrfTarget(url, { allowLocalhostDevServers: true });
      if (!ssrfCheck.valid) {
        const isReservedPort = ssrfCheck.code === 'RESERVED_PORT_3000';
        return res.status(isReservedPort ? 400 : 403).json({
          error: isReservedPort ? 'Reserved Port' : 'Forbidden',
          message: ssrfCheck.error,
          code: ssrfCheck.code,
          reservedPort: isReservedPort ? 3000 : undefined,
        });
      }

      const hostname = parsedUrl.hostname.toLowerCase();
      const isLocalhost =
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname === '::1';

      // 6. Sanitize Request Headers
      const sanitizedHeaders: Record<string, string> = {};
      if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
        for (const [k, v] of Object.entries(headers)) {
          if (typeof k === 'string' && typeof v === 'string') {
            const lowerKey = k.toLowerCase();
            if (['host', 'connection', 'content-length'].includes(lowerKey)) continue;
            sanitizedHeaders[k] = v;
          }
        }
      }
      sanitizedHeaders['User-Agent'] = 'NodeCompiler-ThunderClient/1.0';

      // 7. Build Candidate URLs for Resilient Localhost Resolution (IPv6 vs IPv4 vs Container Host)
      const candidateUrls: string[] = [url];
      if (isLocalhost) {
        // Fallback candidate 1: Explicit IPv4 loopback
        if (hostname !== '127.0.0.1') {
          try {
            const uIpv4 = new URL(url);
            uIpv4.hostname = '127.0.0.1';
            candidateUrls.push(uIpv4.toString());
          } catch {}
        }
        // Fallback candidate 2: Docker worker container or host gateway
        const workerHost = process.env.WORKER_HOST || (process.env.DOCKER_CONTAINER ? 'worker-pool' : null);
        if (workerHost && hostname !== workerHost) {
          try {
            const uDocker = new URL(url);
            uDocker.hostname = workerHost;
            candidateUrls.push(uDocker.toString());
          } catch {}
        }
      }

      const requestPayload = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod) && body !== null && body !== undefined
        ? body
        : undefined;

      const startTime = Date.now();
      let response: any = null;
      let lastError: any = null;

      // Dispatch request with failover across candidate hosts
      for (const targetCandidateUrl of candidateUrls) {
        try {
          response = await axios({
            url: targetCandidateUrl,
            method: normalizedMethod as any,
            headers: sanitizedHeaders,
            data: requestPayload,
            timeout: 10000,
            validateStatus: () => true, // Return actual status (e.g. 200, 404, 500)
            transformResponse: [(d) => d], // Raw response
          });
          break; // Request succeeded
        } catch (err: any) {
          lastError = err;
          // Only attempt next candidate if connection was refused or address not resolved
          if (err.code !== 'ECONNREFUSED' && err.code !== 'ENOTFOUND') {
            break;
          }
        }
      }

      // If all candidates failed, provide structured, developer-friendly diagnostic feedback
      if (!response && lastError) {
        if (lastError.code === 'ECONNREFUSED') {
          return res.status(502).json({
            error: 'Target Server Not Reachable',
            code: 'ECONNREFUSED',
            targetPort: effectivePort,
            targetUrl: url,
            message: `No active server is listening on port ${effectivePort}. Verify that your server is running and calling app.listen(${effectivePort}).`,
            troubleshooting: [
              "Click the 'Run' button (▶) in the top bar to start your server process.",
              "Check the Terminal/Console tab to confirm your script didn't exit or throw a runtime error.",
              `Ensure your code calls: app.listen(process.env.PORT || ${effectivePort}, () => console.log('Server online'));`,
              "Ensure your server binds to 0.0.0.0 or 127.0.0.1.",
            ],
          });
        }

        if (lastError.code === 'ETIMEDOUT' || lastError.code === 'ECONNABORTED') {
          return res.status(504).json({
            error: 'Gateway Timeout',
            code: lastError.code,
            message: `Request to ${url} timed out after 10000ms.`,
          });
        }

        return res.status(502).json({
          error: 'Proxy Error',
          message: lastError.message || 'Failed to connect to target URL',
          code: lastError.code,
        });
      }

      const durationMs = Date.now() - startTime;
      const rawData = response.data;
      let parsedData = rawData;
      let isJson = false;

      if (typeof rawData === 'string') {
        try {
          parsedData = JSON.parse(rawData);
          isJson = true;
        } catch {
          parsedData = rawData;
        }
      } else if (typeof rawData === 'object' && rawData !== null) {
        isJson = true;
      }

      const sizeBytes = typeof rawData === 'string'
        ? Buffer.byteLength(rawData, 'utf8')
        : Buffer.byteLength(JSON.stringify(rawData || ''), 'utf8');

      return res.status(200).json({
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: parsedData,
        isJson,
        durationMs,
        sizeBytes,
      });
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation Error',
          message: err.errors[0]?.message || 'Invalid request payload structure.',
          details: err.errors,
        });
      }
      return res.status(502).json({
        error: 'Proxy Error',
        message: err instanceof Error ? err.message : 'Failed to process request',
      });
    }
  });

  /**
   * POST /api/v1/detect-endpoints - Dynamically discover endpoints and listening port from Node.js code
   */
  router.post('/api/v1/detect-endpoints', (req: Request, res: Response) => {
    try {
      const parsedBody = detectEndpointsSchema.parse(req.body);
      const validatedFiles = validateProjectFiles(parsedBody.files, parsedBody.entryFile || 'index.js');
      const scanResult = scanProjectEndpoints(validatedFiles, parsedBody.entryFile || 'index.js');
      return res.status(200).json(scanResult);
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation Error',
          message: err.errors[0]?.message || 'Invalid detect endpoints request payload.',
          details: err.errors,
        });
      }
      return res.status(500).json({ error: 'Internal Server Error', message: String(err) });
    }
  });

  return router;
}

export function createApp() {
  const app = express();

  // 1. Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // 2. CORS
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Trace-Id', 'X-User-Id'],
    })
  );

  // 3. Body Parser with hard size limit
  app.use(express.json({ limit: `${SYSTEM_LIMITS.MAX_REQUEST_BODY_BYTES}b` }));

  // 4. Request Correlation & Audit Logger
  app.use(authAndCorrelationMiddleware());

  // 5. Serve Frontend Static Assets
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));

  // 6. Mount Compiler API Router
  app.use(createCompilerRouter());

  // 7. Centralized Error Handler Middleware
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const traceId = (req as any).traceId || (req.headers['x-trace-id'] as string) || `trace-${Date.now()}`;
    const statusCode = err.statusCode || (err.status && typeof err.status === 'number' ? err.status : 500);
    const errorCode = err.code || 'INTERNAL_SERVER_ERROR';
    const message = err.message || 'An internal server error occurred.';

    logger.error({ err, traceId, statusCode }, 'Centralized error handler intercepted exception');

    if (statusCode >= 500) {
      AlertService.getInstance().recordAlert({
        severity: 'CRITICAL',
        category: 'CRASH',
        traceId,
        message: `HTTP ${statusCode} Server Error: ${message}`,
        details: { path: req.path, method: req.method, code: errorCode },
      });
    }

    res.status(statusCode).json({
      error: err.name || 'Error',
      code: errorCode,
      message,
      traceId,
      timestamp: new Date().toISOString(),
      details: err.details || undefined,
    });
  });

  // 404 Fallback
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found', message: 'API route does not exist.' });
  });

  return app;
}

// Global Crash Shield - Protects Main Server against Unhandled Crashes
process.on('uncaughtException', (err) => {
  logger.error({ err: err?.message || err, stack: err?.stack }, 'Uncaught Exception absorbed - Main Gateway sustained');
  AlertService.getInstance().recordAlert({
    severity: 'CRITICAL',
    category: 'CRASH',
    message: `Gateway Uncaught Exception: ${err?.message || err}`,
    details: { stack: err?.stack },
  });
});

process.on('unhandledRejection', (reason: any) => {
  logger.error({ reason }, 'Unhandled Rejection absorbed - Main Gateway sustained');
  AlertService.getInstance().recordAlert({
    severity: 'CRITICAL',
    category: 'CRASH',
    message: `Gateway Unhandled Rejection: ${reason?.message || reason}`,
    details: { stack: reason?.stack },
  });
});

// Auto-start server if executed directly
if (require.main === module) {
  const app = createApp();
  const server = app.listen(PORT, HOST, () => {
    logger.info(`Node Compiler API Gateway running at http://${HOST}:${PORT}`);
  });

  const handleShutdown = async (signal: string) => {
    logger.info({ signal }, 'Termination signal received in Gateway');
    server.close(async () => {
      logger.info('HTTP server successfully closed.');
      try {
        await StreamService.getInstance().close();
        await DatabaseService.getInstance().close();
      } catch {}
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}
