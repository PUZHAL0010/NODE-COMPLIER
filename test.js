import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '5s', target: 10 },   // Ramp up to 10 VUs
    { duration: '15s', target: 20 },  // Stay at 20 VUs
    { duration: '5s', target: 0 },    // Ramp down to 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests should be below 500ms
    http_req_failed: ['rate<0.05'],    // Error rate under 5%
  },
};

// When running inside Docker, host machine services are at host.docker.internal
// When running native k6, you can pass -e TARGET_URL=http://localhost:3000
const BASE_URL = __ENV.TARGET_URL || 'http://host.docker.internal:3000';

export default function () {
  // 1. Health Probe Check
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, {
    'health status is 200': (r) => r.status === 200,
    'health returns ok': (r) => {
      try {
        return JSON.parse(r.body).status === 'ok';
      } catch (e) {
        return false;
      }
    },
  });

  // 2. Readiness Probe Check
  const readyRes = http.get(`${BASE_URL}/ready`);
  check(readyRes, {
    'ready status is 200': (r) => r.status === 200,
  });

  // 3. System Metrics Check
  const metricsRes = http.get(`${BASE_URL}/api/v1/metrics`);
  check(metricsRes, {
    'metrics status is 200': (r) => r.status === 200,
  });

  // 4. Code Execution Submission Check
  const payload = JSON.stringify({
    projectId: 'k6-benchmark-test',
    entryFile: 'index.js',
    files: [
      {
        path: 'index.js',
        content: 'console.log("Hello from k6 load test!");',
      },
    ],
    options: {
      timeoutMs: 3000,
    },
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': `k6-vu-${__VU}`,
    },
  };

  const jobRes = http.post(`${BASE_URL}/api/v1/jobs`, payload, params);
  check(jobRes, {
    'job submission accepted (202)': (r) => r.status === 202,
  });

  // 5. System Alerts Check
  const alertsRes = http.get(`${BASE_URL}/api/v1/alerts`);
  check(alertsRes, {
    'alerts status is 200': (r) => r.status === 200,
  });

  sleep(0.5);
}
