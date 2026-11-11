# Production-Ready Distributed Node.js Web IDE & Secure Execution Platform

A high-performance, security-first, distributed browser-based Web IDE and multi-tenant code execution engine engineered for **150+ concurrent developers**. Built with a OneCompiler-inspired dark IDE interface, asynchronous queue-driven execution architecture, rootless container sandboxes, real-time output streaming, TypeScript transpilation, and sandboxed HTML/CSS/JS preview.

---

## 1. System Architecture

```text
+-------------------------------------------------------------------------+
|                           BROWSER / WEB IDE                             |
|  - Monaco Editor (HTML, CSS, JS, TS, JSON)                              |
|  - Virtual File Tree, Multi-Tab Manager, Dirty Markers                  |
|  - Real-Time SSE Stream Consumer                                        |
|  - Sandboxed Preview iframe (CSP: default-src 'none', allow-scripts)   |
|  - Output Workbench (Terminal, Problems, Structured JSON, Metrics)      |
+-------------------------------------------------------------------------+
                                     |
                         HTTPS / SSE / REST JSON
                                     v
+-------------------------------------------------------------------------+
|                         STATELESS API GATEWAY                           |
|  - Helmet Security Headers & Strict CORS                                |
|  - Token Bucket Rate Limiting (10 req/min/IP + Per-User Concurrency)    |
|  - Strict Zod Schema & Canonical Path Traversal Validation              |
|  - Static AST Security Pre-Scan (Defense-in-depth)                      |
|  - Job Submission & SSE Stream Broker                                   |
|  - Health & Readiness Probes (/healthz, /readyz, /api/v1/metrics)       |
+-------------------------------------------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                             REDIS + BULLMQ                              |
|  - Queue: `node-execution`                                              |
|  - Concurrency Quotas & Fair Per-User / Per-Project Scheduling          |
|  - Exponential Backoff (Infrastructure Failures only; No user loop loop)|
|  - Real-Time Event PubSub Broadcasting (`stream:${jobId}`)              |
+-------------------------------------------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                   EXECUTION DISPATCHER & WORKER POOL                    |
|  - Worker Supervisor with Configurable Concurrency                      |
|  - In-Memory TypeScript Compiler Host with Structured Diagnostics       |
|  - Multi-File Virtual Module Resolution (ESM & CommonJS interop)        |
|  - Sandbox Lifecycle Supervision (DockerSandboxRuntime / Firecracker)   |
+-------------------------------------------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                      ISOLATED EXECUTION SANDBOX                         |
|  - Rootless Container (`node` user UID 1000:1000)                       |
|  - Network Isolation: `--network=none`                                  |
|  - Read-Only Base Filesystem: `--read-only`                             |
|  - Hard Caps: 512MB RAM, 1.0 CPU, 32 PIDs, 5s Execution Timeout         |
|  - Bounded Buffer Collectors: 1MB Stdout, 1MB Stderr (Anti-Memory DoS)  |
|  - Ephemeral Workspace Cleaned Up in `finally` Block                    |
+-------------------------------------------------------------------------+
```

---

## 2. Technology Stack

* **Frontend**: HTML5, CSS3 (OneCompiler dark design tokens), Vanilla JavaScript, Monaco Editor, Server-Sent Events (SSE), Sandboxed `<iframe>`.
* **Backend**: Node.js 20 LTS, TypeScript, Express, Helmet, CORS, Zod, Pino Structured Logger, nanoid.
* **Distributed Queue**: BullMQ, Redis 7 (PubSub streaming, lock recovery, stalled job detection).
* **Compiler & Static Analysis**: TypeScript Compiler API, `@babel/parser`, `@babel/traverse`.
* **Sandboxing**: `SandboxRuntime` abstraction, `DockerSandboxRuntime` (Rootless, unprivileged, cgroup-constrained), `ProcessSandboxRuntime` (deterministic fallback & CI runner).

---

## 3. Quickstart & Deployment

### Option A: Complete Docker Compose Orchestration (Recommended)

To run the complete platform with Redis, API Gateway, Worker Pool, and the hardened Sandbox Runner:

```bash
# 1. Clone & enter repository
cd "c:\Users\PUGHAL . S\Downloads\NODE COMPLIER"

# 2. Build and launch all services in background
docker-compose up --build -d

# 3. Access Web IDE
open http://localhost:3000
```

### Option B: Local Development Mode

```bash
# 1. Install dependencies
npm install

# 2. Start local Redis server (if not already running)
redis-server

# 3. Start API Gateway and Worker concurrently
npm run dev

# 4. Open in browser
open http://localhost:3000
```

---

## 4. API Reference

### `POST /api/v1/jobs`
Submit an execution job to the distributed queue.

**Request Body:**
```json
{
  "projectId": "my-project-01",
  "entryFile": "index.js",
  "files": [
    {
      "path": "index.js",
      "content": "import { add } from './utils.js'; console.log('Result:', add(10, 32));"
    },
    {
      "path": "utils.js",
      "content": "export const add = (a, b) => a + b;"
    }
  ],
  "options": {
    "timeoutMs": 5000,
    "memoryMb": 512,
    "cpus": 1.0
  }
}
```

**Response (202 Accepted):**
```json
{
  "jobId": "job-X9jL12mK90pQ",
  "status": "QUEUED",
  "streamUrl": "/api/v1/jobs/job-X9jL12mK90pQ/stream",
  "statusUrl": "/api/v1/jobs/job-X9jL12mK90pQ"
}
```

---

### `GET /api/v1/jobs/:jobId/stream`
Server-Sent Events (SSE) streaming endpoint delivering real-time execution events.

**Event Protocol:**
* `type: "stdout"` &mdash; Live standard output chunk
* `type: "stderr"` &mdash; Live standard error chunk
* `type: "status"` &mdash; Lifecycle state transition (`QUEUED`, `RUNNING`, `SUCCESS`, `COMPILATION_ERROR`, etc.)
* `type: "compile_error"` &mdash; Structured TypeScript diagnostic with line and column numbers
* `type: "metrics"` &mdash; Execution telemetry (RAM, duration, workerId, sandboxId)
* `type: "exit"` &mdash; Process completion with exit code

---

### `POST /api/v1/jobs/:jobId/cancel`
Idempotently signals the worker and kills the sandbox process tree.

---

### `POST /api/v1/preview`
Generates a consolidated, sanitized HTML bundle with inlined CSS/JS and injected Content Security Policy for sandboxed `<iframe>` preview.

---

### `GET /api/v1/metrics`
Returns aggregated throughput, duration percentiles (p50, p95, p99), error breakdowns, and worker queue depths.

---

### `GET /healthz` & `GET /readyz`
Kubernetes-compatible liveness and readiness health probes.

---

## 5. Security & Isolation Boundaries

1. **Zero Host Execution**: Untrusted code is **never** executed on the API Gateway or worker host process.
2. **Rootless & Unprivileged**: Sandboxes execute as UID `1000:1000` (`node` user) with `--security-opt no-new-privileges:true`.
3. **Capability Stripping**: Containers drop all Linux capabilities (`--cap-drop=ALL`).
4. **Network Blackhole**: Enforces `--network=none` preventing any outbound or inbound sockets.
5. **Path Traversal Shield**: Canonical path resolution rejects `..`, `\`, null bytes `\0`, absolute paths, and reserved system device names.
6. **AST Static Pre-Scan**: Defense-in-depth AST parsing scans for restricted modules (`child_process`, `worker_threads`, `vm`, `net`, `http`, `dlopen`).
7. **Buffer Exhaustion Mitigation**: Bounded string accumulators strictly cap stdout and stderr at 1MB, preventing heap memory flooding.
8. **Iframe Preview Isolation**: Rendered inside `<iframe sandbox="allow-scripts">` with CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none';` and JS protection neutralizing parent DOM, cookies, and local storage access.

---

## 6. Automated Testing Suite

The codebase includes full unit, integration, and load test suites.

```bash
# Run all tests
npm test

# Run unit tests only (File validation, AST security, TypeScript compiler, Buffer safety)
npm run test:unit

# Run acceptance integration tests (Tests 1 - 10)
npm run test:integration

# Run 150+ concurrent developer load test benchmark
npm run test:load
```

### Acceptance Test Verification Matrix:
* **Test 1 &mdash; JavaScript & JSON**: Executes JavaScript, captures stdout, and parses structured JSON output.
* **Test 2 &mdash; Runtime Error**: Captures uncaught exceptions, non-zero exit codes, and stderr.
* **Test 3 &mdash; Timeout**: Terminates infinite loops (`while(true){}`) strictly at 5s limit.
* **Test 4 &mdash; TypeScript Execution**: Compiles `.ts` source and executes generated JavaScript.
* **Test 5 &mdash; TypeScript Diagnostics**: Returns structured `COMPILATION_ERROR` with file, line, and column.
* **Test 6 &mdash; Multi-File Resolution**: Resolves relative imports between `.js`, `.ts`, and `.json`.
* **Test 7 &mdash; HTML Preview**: Inlines assets, injects CSP, and isolates parent window.
* **Test 8 &mdash; Path Traversal**: Rejects `../../secret.txt` attempts with HTTP 400.
* **Test 9 &mdash; Network Isolation**: Verifies network unavailability from within the sandbox.
* **Test 10 &mdash; Cancellation**: Verifies idempotent cancellation and process termination.

---

## 7. Final Engineering & Architectural Review

### 1. Remaining Single Points of Failure
* **Redis Cluster**: In single-instance mode, Redis is a central coordination point for BullMQ and PubSub streams. **Production Fix**: Deploy Redis Sentinel or Redis Cluster with multi-AZ replication.
* **Docker Daemon**: If using Docker socket mounting on worker nodes, a Docker daemon restart interrupts running sandboxes. **Production Fix**: Use Firecracker microVMs or containerd directly via gRPC.

### 2. Hardware Requirements
* **Baseline (150 active developers, ~20 simultaneous executions)**:
  * 4 CPU Cores (e.g. 2x API Gateway @ 1 vCPU, 2x Worker Pool @ 1 vCPU).
  * 8 GB RAM (512MB per active sandbox * 8 concurrent sandboxes + OS & Redis buffers).
  * 20 GB NVMe SSD for fast container workspace mounts.

### 3. Scaling Strategy (150 &rarr; 500 &rarr; 1,000+ Concurrent Developers)

```text
                       [ Global Anycast Load Balancer ]
                                      |
                     +----------------+----------------+
                     |                                 |
         [ API Gateway Cluster ]             [ API Gateway Cluster ]
          (Autoscaling: 5 - 15 Pods)          (Autoscaling: 5 - 15 Pods)
                     |                                 |
                     +----------------+----------------+
                                      |
                           [ Redis Cluster 7.x ]
                       (Sentinel / Multi-Node Sharded)
                                      |
                     +----------------+----------------+
                     |                                 |
           [ Worker Node Pool A ]            [ Worker Node Pool B ]
           (K8s DaemonSet / Warm Pool)        (K8s DaemonSet / Warm Pool)
                     |                                 |
          [ Sandboxes / MicroVMs ]          [ Sandboxes / MicroVMs ]
```

* **From 150 to 500 Developers**:
  * Horizontally scale API Gateway pods from 2 to 6 behind an NGINX or ALB ingress controller.
  * Horizontally scale BullMQ Workers across 3 node hosts with concurrency=12 each.
* **From 500 to 1,000+ Developers**:
  * Transition to **Kubernetes with KEDA (Kubernetes Event-driven Autoscaling)** scaling worker pods based on BullMQ `waiting` queue depth.
  * Introduce **Container Pre-warming Pools**: keep a pool of idle, network-isolated containers ready to receive workspaces, reducing cold-start latency from ~300ms to < 25ms.

### 4. Transition Roadmap to Firecracker MicroVMs
The platform's pluggable `SandboxRuntime` interface was designed to allow replacing `DockerSandboxRuntime` with `FirecrackerSandboxRuntime` without altering the API Gateway or worker contracts:
1. Implement `FirecrackerSandboxRuntime` implementing `SandboxRuntime`.
2. Boot minimal guest kernel (~5MB) with a read-only rootfs containing Node.js 20.
3. Attach ephemeral ext4 workspace drive via `/dev/vdb`.
4. Firecracker provides hardware-level virtualization (KVM) with hypervisor isolation, eliminating kernel-sharing vulnerabilities.
