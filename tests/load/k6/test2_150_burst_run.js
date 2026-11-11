/**
 * k6 Load Test 2: 150 Simultaneous "Run" Clicks (Instant Spike)
 * Simulates 150 users clicking "Run" at the exact same second.
 * Verifies queue backpressure, zero dropped connections, and orderly completion.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

export const acceptedJobs = new Counter('ide_burst_accepted_jobs');
export const completedJobs = new Counter('ide_burst_completed_jobs');
export const allJobsSuccess = new Rate('ide_burst_success_rate');

export const options = {
  scenarios: {
    instant_burst_150: {
      executor: 'shared-iterations',
      vus: 150,
      iterations: 150, // Exactly 150 runs triggered concurrently
      maxDuration: '2m',
    },
  },
  thresholds: {
    'http_req_failed': ['rate==0'], // Zero HTTP errors
    'ide_burst_success_rate': ['rate==1.0'], // 100% of jobs succeed
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const userId = `burst-user-${__VU}`;
  const projectId = `burst-proj-${__VU}`;

  const payload = JSON.stringify({
    projectId,
    entryFile: 'index.js',
    files: [
      {
        path: 'index.js',
        content: `console.log("BURST_EXECUTION_OK: " + process.env.PORT + " " + Date.now());`,
      },
    ],
    options: {
      timeoutMs: 8000,
      memoryMb: 128,
    },
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
      'X-Trace-Id': `burst-trace-${__VU}-${Date.now()}`,
    },
  };

  // Instant parallel submission
  const submitRes = http.post(`${BASE_URL}/api/v1/jobs`, payload, params);

  const accepted = check(submitRes, {
    'instant burst returns 202 Accepted': (r) => r.status === 202,
    'contains jobId': (r) => JSON.parse(r.body).jobId !== undefined,
  });

  if (accepted) {
    acceptedJobs.add(1);
  } else {
    allJobsSuccess.add(0);
    return;
  }

  const { jobId } = JSON.parse(submitRes.body);

  // Poll until completion
  let finished = false;
  let attempts = 0;

  while (!finished && attempts < 40) {
    sleep(0.5);
    attempts++;

    const pollRes = http.get(`${BASE_URL}/api/v1/jobs/${jobId}`);
    if (pollRes.status === 200) {
      try {
        const body = JSON.parse(pollRes.body);
        if (body.status === 'SUCCESS') {
          finished = true;
          completedJobs.add(1);
          allJobsSuccess.add(1);
        } else if (body.status !== 'QUEUED' && body.status !== 'RUNNING') {
          finished = true;
          allJobsSuccess.add(0);
        }
      } catch {
        finished = true;
        allJobsSuccess.add(0);
      }
    }
  }

  check(null, {
    'burst job drained successfully': () => finished,
  });
}
