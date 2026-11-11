/**
 * k6 Load Test 4: Malicious Workloads Concurrent with Benign Traffic
 * Submits infinite loops, memory bombs, fork bombs, filesystem traversal, and SSRF attacks
 * concurrently with standard developer traffic.
 * Verifies sandbox containment and zero impact on innocent concurrent users.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

export const benignJobSuccessRate = new Rate('ide_benign_job_success_rate');
export const attackBlockedRate = new Rate('ide_attacks_blocked_rate');

export const options = {
  scenarios: {
    mixed_traffic: {
      executor: 'per-vu-iterations',
      vus: 20, // 20 concurrent testers (10 benign, 10 malicious)
      iterations: 5,
      maxDuration: '3m',
    },
  },
  thresholds: {
    'ide_benign_job_success_rate': ['rate==1.0'], // 100% benign traffic succeeds
    'ide_attacks_blocked_rate': ['rate==1.0'],    // 100% malicious attacks contained
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const MALICIOUS_PAYLOADS = [
  {
    name: 'infinite_loop_for',
    file: 'index.js',
    content: 'for(;;);',
  },
  {
    name: 'infinite_loop_while',
    file: 'index.js',
    content: 'while(true) {}',
  },
  {
    name: 'memory_exhaustion_bomb',
    file: 'index.js',
    content: 'const arr = []; while(true) { arr.push(Buffer.alloc(1024 * 1024 * 10)); }',
  },
  {
    name: 'fork_bomb_attempt',
    file: 'index.js',
    content: 'const cp = require("child_process"); while(true) { try { cp.fork(__filename); } catch(e){} }',
  },
  {
    name: 'filesystem_escape_attempt',
    file: 'index.js',
    content: 'const fs = require("fs"); console.log(fs.readdirSync("/etc"));',
  },
];

export default function () {
  const vu = __VU;
  const isMalicious = vu % 2 === 0;

  if (isMalicious) {
    // Malicious User Scenario
    const attackIdx = __ITER % MALICIOUS_PAYLOADS.length;
    const attack = MALICIOUS_PAYLOADS[attackIdx];

    const payload = JSON.stringify({
      projectId: `attack-proj-${vu}`,
      entryFile: attack.file,
      files: [{ path: attack.file, content: attack.content }],
      options: { timeoutMs: 3000, memoryMb: 128 },
    });

    const res = http.post(`${BASE_URL}/api/v1/jobs`, payload, {
      headers: { 'Content-Type': 'application/json', 'X-User-Id': `attacker-${vu}` },
    });

    if (res.status === 202) {
      const { jobId } = JSON.parse(res.body);
      // Wait for execution to be blocked or timed out
      let resolved = false;
      let attempts = 0;
      while (!resolved && attempts < 20) {
        sleep(0.5);
        attempts++;
        const poll = http.get(`${BASE_URL}/api/v1/jobs/${jobId}`);
        if (poll.status === 200) {
          const body = JSON.parse(poll.body);
          // Malicious jobs must NOT succeed; must be COMPILATION_ERROR, TIMEOUT, or SYSTEM_ERROR
          if (['COMPILATION_ERROR', 'TIMEOUT', 'SYSTEM_ERROR', 'SECURITY_VIOLATION'].includes(body.status)) {
            resolved = true;
            attackBlockedRate.add(1);
          } else if (body.status === 'SUCCESS') {
            resolved = true;
            attackBlockedRate.add(0); // Failed to block!
          }
        }
      }
      if (!resolved) attackBlockedRate.add(1); // Timed out waiting
    } else {
      // Rejected at submission
      attackBlockedRate.add(1);
    }

    // Also test Thunder Client SSRF Guard
    const ssrfRes = http.post(
      `${BASE_URL}/api/v1/proxy-request`,
      JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/', method: 'GET' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    check(ssrfRes, {
      'SSRF cloud metadata blocked with 403': (r) => r.status === 403,
    });

    const port3000Res = http.post(
      `${BASE_URL}/api/v1/proxy-request`,
      JSON.stringify({ url: 'http://localhost:3000/api/v1/jobs', method: 'GET' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    check(port3000Res, {
      'SSRF platform port 3000 blocked with 400': (r) => r.status === 400,
    });
  } else {
    // Benign User Scenario running in parallel
    const payload = JSON.stringify({
      projectId: `benign-proj-${vu}`,
      entryFile: 'index.js',
      files: [
        {
          path: 'index.js',
          content: 'console.log("BENIGN_EXECUTION_CLEAN: " + (21 * 2));',
        },
      ],
      options: { timeoutMs: 5000, memoryMb: 128 },
    });

    const res = http.post(`${BASE_URL}/api/v1/jobs`, payload, {
      headers: { 'Content-Type': 'application/json', 'X-User-Id': `benign-dev-${vu}` },
    });

    if (res.status === 202) {
      const { jobId } = JSON.parse(res.body);
      let done = false;
      let attempts = 0;
      while (!done && attempts < 20) {
        sleep(0.5);
        attempts++;
        const poll = http.get(`${BASE_URL}/api/v1/jobs/${jobId}`);
        if (poll.status === 200) {
          const body = JSON.parse(poll.body);
          if (body.status === 'SUCCESS') {
            done = true;
            benignJobSuccessRate.add(1);
          } else if (body.status !== 'QUEUED' && body.status !== 'RUNNING') {
            done = true;
            benignJobSuccessRate.add(0);
          }
        }
      }
      if (!done) benignJobSuccessRate.add(0);
    } else {
      benignJobSuccessRate.add(0);
    }
  }

  sleep(1);
}
