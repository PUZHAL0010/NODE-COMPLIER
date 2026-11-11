/**
 * k6 Load Test 3: 300 Concurrent Users (200% Overload Stress Test)
 * Tests platform resilience under double normal operating capacity.
 * Verifies that rate limiting (HTTP 429), queue backpressure, and memory limits hold firm
 * with 0 host crashes and 0 HTTP 500 errors.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

export const rateLimit429Counter = new Counter('ide_rate_limit_429_total');
export const acceptedJobsCounter = new Counter('ide_stress_accepted_total');
export const zeroHostCrashes = new Rate('ide_zero_host_crashes_rate');

export const options = {
  scenarios: {
    overload_stress_300: {
      executor: 'constant-vus',
      vus: 300,
      duration: '2m',
    },
  },
  thresholds: {
    // There must be ZERO HTTP 500 Internal Server Errors (429 rate limit is expected and healthy)
    'http_req_failed{status:500}': ['rate==0'],
    'ide_zero_host_crashes_rate': ['rate==1.0'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const vuId = __VU;
  const userId = `stress-user-${vuId % 30}`; // Simulate 30 aggressive users firing 10 requests each concurrently
  const projectId = `proj-${vuId % 30}`;

  const payload = JSON.stringify({
    projectId,
    entryFile: 'index.js',
    files: [
      {
        path: 'index.js',
        content: `console.log("STRESS_TEST_USER: ${userId}");`,
      },
    ],
    options: {
      timeoutMs: 4000,
      memoryMb: 64,
    },
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
    },
  };

  const res = http.post(`${BASE_URL}/api/v1/jobs`, payload, params);

  // Assert that responses are either 202 (Accepted) or 429 (Too Many Requests / Rate Limited)
  // Under NO circumstances should the server return 500 Internal Server Error
  const isValidResponse = check(res, {
    'no 500 server error': (r) => r.status !== 500 && r.status !== 502 && r.status !== 503,
    'handled as 202 or 429': (r) => r.status === 202 || r.status === 429,
  });

  if (res.status === 429) {
    rateLimit429Counter.add(1);
    check(res, {
      '429 response contains Retry-After header': (r) => r.headers['Retry-After'] !== undefined,
    });
  } else if (res.status === 202) {
    acceptedJobsCounter.add(1);
  }

  zeroHostCrashes.add(isValidResponse ? 1 : 0);

  sleep(0.5);
}
