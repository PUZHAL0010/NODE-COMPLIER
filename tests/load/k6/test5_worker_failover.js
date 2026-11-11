/**
 * k6 Load Test 5: Worker Pool Failover & Heartbeat Resilience
 * Verifies that jobs submitted to the distributed queue remain intact
 * and complete even if individual workers cycle or experience transient delays.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

export const jobRecoveryRate = new Rate('ide_worker_job_recovery_rate');

export const options = {
  scenarios: {
    worker_failover: {
      executor: 'constant-vus',
      vus: 20,
      duration: '1m30s',
    },
  },
  thresholds: {
    'ide_worker_job_recovery_rate': ['rate>0.98'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const userId = `failover-user-${__VU}`;

  // Check cluster readiness
  const readyRes = http.get(`${BASE_URL}/readyz`);
  check(readyRes, {
    'cluster is ready': (r) => r.status === 200,
  });

  const payload = JSON.stringify({
    projectId: `failover-proj-${__VU}`,
    entryFile: 'index.js',
    files: [
      {
        path: 'index.js',
        content: `
          setTimeout(() => {
            console.log("FAILOVER_RESILIENCE_OK");
          }, 100);
        `,
      },
    ],
    options: { timeoutMs: 10000, memoryMb: 128 },
  });

  const submitRes = http.post(`${BASE_URL}/api/v1/jobs`, payload, {
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
  });

  if (submitRes.status === 202) {
    const { jobId } = JSON.parse(submitRes.body);
    let done = false;
    let attempts = 0;
    while (!done && attempts < 30) {
      sleep(0.5);
      attempts++;
      const poll = http.get(`${BASE_URL}/api/v1/jobs/${jobId}`);
      if (poll.status === 200) {
        const body = JSON.parse(poll.body);
        if (body.status === 'SUCCESS') {
          done = true;
          jobRecoveryRate.add(1);
        } else if (body.status !== 'QUEUED' && body.status !== 'RUNNING') {
          done = true;
          jobRecoveryRate.add(0);
        }
      }
    }
    if (!done) jobRecoveryRate.add(0);
  } else {
    jobRecoveryRate.add(0);
  }

  sleep(1);
}
