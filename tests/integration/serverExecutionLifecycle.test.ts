/**
 * Integration Tests: Server Execution Lifecycle & Port Conflict Resilience
 * Verifies that:
 * 1. HTTP/Express servers run reliably on PORT (3001+).
 * 2. Consecutive executions cancel previous sandboxes and never fail with EADDRINUSE.
 * 3. Attempting to bind to reserved platform port 3000 provides clear advisory without crashing.
 * 4. Custom developer ports (e.g. 3002, 4000) function properly.
 */

import { ExecutionProcessor } from '../../server/processor';
import { JobStatus, ExecutionJob } from '../../shared/types';
import { resolveExecutionLimits } from '../../server/utils/limits';
import { isPortAvailable } from '../../server/utils/portManager';

describe('Server Execution Lifecycle & Port Resilience', () => {
  let processor: ExecutionProcessor;

  beforeAll(() => {
    processor = new ExecutionProcessor();
  });

  afterAll(async () => {
    await ExecutionProcessor.cancelJobsForProject('test-server-proj');
    await ExecutionProcessor.cancelJobsForProject('test-port3000-proj');
  });

  it('runs an HTTP server on process.env.PORT and starts listening', async () => {
    const job: ExecutionJob = {
      jobId: 'job-server-test-1',
      userId: 'test-user',
      projectId: 'test-server-proj',
      entryFile: 'server.js',
      files: [
        {
          path: 'server.js',
          content: `
            const http = require('http');
            const port = process.env.PORT || 3001;
            const server = http.createServer((req, res) => res.end('OK'));
            server.listen(port, () => {
              console.log('HTTP Server listening on port ' + port);
            });
            setTimeout(() => {
              server.close();
              process.exit(0);
            }, 1000);
          `,
        },
      ],
      limits: resolveExecutionLimits({ timeoutMs: 5000 }),
      enqueuedAt: Date.now(),
      traceId: 'trace-test-1',
    };

    const result = await processor.processJob(job);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('HTTP Server listening on port');
    expect(result.stderr).not.toContain('EADDRINUSE');
  }, 10000);

  it('re-runs consecutive servers without EADDRINUSE conflict', async () => {
    // Run 1: Server running
    const job1: ExecutionJob = {
      jobId: 'job-server-consecutive-1',
      userId: 'test-user',
      projectId: 'test-server-proj',
      entryFile: 'server.js',
      files: [
        {
          path: 'server.js',
          content: `
            const http = require('http');
            const port = process.env.PORT || 3001;
            const server = http.createServer((req, res) => res.end('OK 1'));
            server.listen(port, () => {
              console.log('Run 1 server listening on port ' + port);
            });
            setTimeout(() => {
              server.close();
              process.exit(0);
            }, 1200);
          `,
        },
      ],
      limits: resolveExecutionLimits({ timeoutMs: 5000 }),
      enqueuedAt: Date.now(),
      traceId: 'trace-test-consec-1',
    };

    // Run 2: Immediately re-running the project
    const job2: ExecutionJob = {
      jobId: 'job-server-consecutive-2',
      userId: 'test-user',
      projectId: 'test-server-proj',
      entryFile: 'server.js',
      files: [
        {
          path: 'server.js',
          content: `
            const http = require('http');
            const port = process.env.PORT || 3001;
            const server = http.createServer((req, res) => res.end('OK 2'));
            server.listen(port, () => {
              console.log('Run 2 server listening on port ' + port);
            });
            setTimeout(() => {
              server.close();
              process.exit(0);
            }, 1000);
          `,
        },
      ],
      limits: resolveExecutionLimits({ timeoutMs: 5000 }),
      enqueuedAt: Date.now(),
      traceId: 'trace-test-consec-2',
    };

    // Execute job 1 and then job 2
    const res1Promise = processor.processJob(job1);
    await new Promise((r) => setTimeout(r, 200)); // allow job 1 to start listening
    const res2 = await processor.processJob(job2);
    await res1Promise.catch(() => {});

    expect(res2.exitCode).toBe(0);
    expect(res2.stdout).toContain('Run 2 server listening on port');
    expect(res2.stderr).not.toContain('EADDRINUSE');
  }, 15000);

  it('provides clean PORT_CONFLICT advisory if code attempts to bind to reserved platform port 3000', async () => {
    // If the port 3000 is occupied or fails to bind, it should catch and output the advisory
    const job: ExecutionJob = {
      jobId: 'job-port3000-conflict',
      userId: 'test-user',
      projectId: 'test-port3000-proj',
      entryFile: 'server.js',
      files: [
        {
          path: 'server.js',
          content: `
            const net = require('net');
            // Simulate or bind 3000
            const server = net.createServer();
            server.listen(3000, () => {
              console.log('Listening on 3000');
              server.close();
            });
          `,
        },
      ],
      limits: resolveExecutionLimits({ timeoutMs: 4000 }),
      enqueuedAt: Date.now(),
      traceId: 'trace-port3000',
    };

    const res = await processor.processJob(job);
    expect(res.stderr).toContain('PORT_CONFLICT');
    expect(res.stderr).toContain('Port 3000 is strictly reserved');
  }, 10000);

  it('runs successfully on custom developer port 3002', async () => {
    const job: ExecutionJob = {
      jobId: 'job-server-custom-port',
      userId: 'test-user',
      projectId: 'test-server-proj',
      entryFile: 'server.js',
      files: [
        {
          path: 'server.js',
          content: `
            const http = require('http');
            const customPort = 3002;
            const server = http.createServer((req, res) => res.end('OK'));
            server.listen(customPort, () => {
              console.log('Custom Server listening on port ' + customPort);
            });
            setTimeout(() => {
              server.close();
              process.exit(0);
            }, 800);
          `,
        },
      ],
      limits: resolveExecutionLimits({ timeoutMs: 5000 }),
      enqueuedAt: Date.now(),
      traceId: 'trace-custom-port',
    };

    const result = await processor.processJob(job);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Custom Server listening on port 3002');
    expect(result.stderr).not.toContain('EADDRINUSE');
  }, 10000);
});
