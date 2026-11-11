/**
 * k6 Load Test 1: 150 Concurrent Users Sustained Execution
 * Verifies that the platform effortlessly handles 150 simultaneous active developers
 * compiling and executing Node.js/TypeScript code.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom Prometheus/k6 Metrics
export const executionDuration = new Trend('ide_job_execution_duration_ms');
export const successRate = new Rate('ide_successful_jobs_rate');
export const queueRejections = new Counter('ide_queue_rejections_total');

export const options = {
  scenarios: {
    sustained_150_users: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '30s', target: 50 },   // Warm-up ramp
        { duration: '1m', target: 150 },   // Ramp to target 150 concurrent users
        { duration: '3m', target: 150 },   // Maintain full 150 simultaneous user load
        { duration: '30s', target: 0 },    // Graceful cool-down
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    // SLAs: p95 duration < 2500ms, success rate > 99%, 0% HTTP 5xx errors
    'http_req_failed': ['rate<0.01'],
    'ide_successful_jobs_rate': ['rate>0.99'],
    'ide_job_execution_duration_ms': ['p(95)<2500', 'p(99)<4000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const vuId = __VU;
  const iterId = __ITER;
  const userId = `load-user-${vuId}`;
  const projectId = `proj-${vuId}`;

  // Realistic user script with calculations and console output
  const scriptContent = `
    const os = require('os');
    const numbers = Array.from({ length: 50 }, (_, i) => i + 1);
    const sum = numbers.reduce((a, b) => a + b, 0);
    console.log(\`User [${userId}] Iteration [${iterId}] Sum: \${sum}\`);
    console.log("Memory usage: " + JSON.stringify(process.memoryUsage().heapUsed));
  `;

  const payload = JSON.stringify({
    projectId,
    entryFile: 'index.js',
    files: [
      { path: 'index.js', content: scriptContent },
      { path: 'package.json', content: '{"name":"benchmark-proj","main":"index.js"}' }
    ],
    options: {
      timeoutMs: 5000,
      memoryMb: 128,
    },
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
      'X-Trace-Id': `trace-${vuId}-${iterId}-${Date.now()}`,
    },
  };

  const startTime = Date.now();

  // 1. Submit execution job
  const submitRes = http.post(`${BASE_URL}/api/v1/jobs`, payload, params);

  const isAccepted = check(submitRes, {
    'submission status is 202 Accepted': (r) => r.status === 202,
    'jobId is returned': (r) => {
      try {
        return JSON.parse(r.body).jobId !== undefined;
      } catch {
        return false;
      }
    },
  });

  if (!isAccepted) {
    queueRejections.add(1);
    successRate.add(0);
    sleep(1);
    return;
  }

  const { jobId } = JSON.parse(submitRes.body);

  // 2. Poll status until completion (simulating SSE/client polling)
  let isDone = false;
  let attempts = 0;
  const maxAttempts = 30; // Up to 15 seconds

  while (!isDone && attempts < maxAttempts) {
    sleep(0.5);
    attempts++;

    const pollRes = http.get(`${BASE_URL}/api/v1/jobs/${jobId}`, {
      headers: { 'X-User-Id': userId },
    });

    if (pollRes.status === 200) {
      try {
        const body = JSON.parse(pollRes.body);
        if (body.status === 'SUCCESS') {
          isDone = true;
          successRate.add(1);
          executionDuration.add(Date.now() - startTime);
          check(body, {
            'job finished with exitCode 0': (b) => b.result?.exitCode === 0,
            'job produced expected output': (b) => (b.result?.stdout || '').includes('Sum: 1275'),
          });
        } else if (body.status !== 'QUEUED' && body.status !== 'RUNNING') {
          // Terminal error status
          isDone = true;
          successRate.add(0);
        }
      } catch {
        isDone = true;
        successRate.add(0);
      }
    }
  }

  check(null, {
    'job finished within max poll window': () => isDone,
  });

  // User think time between executions
  sleep(Math.random() * 2 + 1);
}
