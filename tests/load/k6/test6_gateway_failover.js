/**
 * k6 Load Test 6: Gateway Replica Failover & Load Balancer High Availability
 * Verifies that traffic distributed through NGINX to multiple gateway replicas
 * experiences 0 dropped connections if one gateway replica experiences high load or reboots.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

export const gatewayAvailabilityRate = new Rate('ide_gateway_availability_rate');

export const options = {
  scenarios: {
    gateway_redundancy: {
      executor: 'constant-vus',
      vus: 50,
      duration: '1m',
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.001'], // 99.9% uptime across failovers
    'ide_gateway_availability_rate': ['rate>0.999'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // Probe liveness and readiness
  const healthRes = http.get(`${BASE_URL}/healthz`);
  const isHealthy = check(healthRes, {
    'healthz status is 200': (r) => r.status === 200,
  });

  const readyRes = http.get(`${BASE_URL}/readyz`);
  const isReady = check(readyRes, {
    'readyz status is 200': (r) => r.status === 200,
  });

  gatewayAvailabilityRate.add(isHealthy && isReady ? 1 : 0);

  // Submit test probe job
  const res = http.post(
    `${BASE_URL}/api/v1/jobs`,
    JSON.stringify({
      projectId: `gw-check-${__VU}`,
      entryFile: 'index.js',
      files: [{ path: 'index.js', content: 'console.log("GATEWAY_ACTIVE");' }],
      options: { timeoutMs: 3000 },
    }),
    {
      headers: { 'Content-Type': 'application/json', 'X-User-Id': `gw-tester-${__VU}` },
    }
  );

  check(res, {
    'job submission handled smoothly': (r) => r.status === 202,
  });

  sleep(0.5);
}
