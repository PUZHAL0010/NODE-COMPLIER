import request from 'supertest';
import { createApp } from '../../server/gateway';

describe('API Gateway Endpoints & Security Validation', () => {
  const app = createApp();

  it('GET /healthz returns 200 OK and status', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });

  it('GET /readyz returns 200 OK and service status', async () => {
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
  });

  it('POST /api/v1/jobs accepts valid execution request', async () => {
    const payload = {
      projectId: 'my-project-101',
      entryFile: 'index.js',
      files: [
        { path: 'index.js', content: 'console.log("Hello from Gateway API");' },
      ],
      options: {
        timeoutMs: 3000,
      },
    };

    const res = await request(app)
      .post('/api/v1/jobs')
      .send(payload);

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeDefined();
    expect(res.body.status).toBe('QUEUED');
    expect(res.body.streamUrl).toContain('/stream');
  });

  it('POST /api/v1/jobs rejects malformed request with 400', async () => {
    const malformedPayload = {
      projectId: 'invalid!project!id#$',
      files: [],
    };

    const res = await request(app)
      .post('/api/v1/jobs')
      .send(malformedPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation Error');
  });

  it('POST /api/v1/jobs rejects path traversal attacks with 400', async () => {
    const maliciousPayload = {
      projectId: 'attack-project',
      entryFile: '../../etc/passwd',
      files: [
        { path: '../../etc/passwd', content: 'root:x:0:0' },
      ],
    };

    const res = await request(app)
      .post('/api/v1/jobs')
      .send(maliciousPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('File Validation Error');
  });

  it('POST /api/v1/preview returns bundled HTML and CSP header', async () => {
    const payload = {
      projectId: 'preview-test',
      files: [
        { path: 'index.html', content: '<h1>Test</h1><script src="app.js"></script>' },
        { path: 'app.js', content: 'console.log(123);' },
      ],
      entryHtml: 'index.html',
    };

    const res = await request(app)
      .post('/api/v1/preview')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.bundledHtml).toContain('Content-Security-Policy');
    expect(res.body.bundledHtml).toContain('<script data-inlined-from="app.js">');
  });

  it('GET /api/v1/metrics returns platform and queue metrics', async () => {
    const res = await request(app).get('/api/v1/metrics');
    expect(res.status).toBe(200);
    expect(res.body.platform).toBeDefined();
    expect(res.body.queue).toBeDefined();
  });

  it('GET /api/v1/alerts returns alerts and healthStatus', async () => {
    const res = await request(app).get('/api/v1/alerts');
    expect(res.status).toBe(200);
    expect(res.body.alerts).toBeDefined();
    expect(res.body.healthStatus).toBeDefined();
  });

  it('GET /health and /ready return 200 OK', async () => {
    const healthRes = await request(app).get('/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe('ok');

    const readyRes = await request(app).get('/ready');
    expect(readyRes.status).toBe(200);
    expect(readyRes.body.ready).toBe(true);
  });

  describe('POST /api/v1/proxy-request validation & proxying', () => {
    it('rejects missing or non-string URL with 400', async () => {
      const res = await request(app)
        .post('/api/v1/proxy-request')
        .send({ method: 'GET' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation Error');
      expect(res.body.message).toContain('URL is required');
    });

    it('rejects invalid URL syntax with 400', async () => {
      const res = await request(app)
        .post('/api/v1/proxy-request')
        .send({ url: 'not-a-valid-url' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid URL');
    });

    it('rejects unsupported protocols (e.g. ftp://) with 400', async () => {
      const res = await request(app)
        .post('/api/v1/proxy-request')
        .send({ url: 'ftp://localhost:3001/file' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation Error');
      expect(res.body.message).toContain('Unsupported protocol');
    });

    it('rejects invalid HTTP methods with 400', async () => {
      const res = await request(app)
        .post('/api/v1/proxy-request')
        .send({ url: 'http://localhost:3001/api', method: 'INVALID_VERB' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation Error');
      expect(res.body.message).toContain('Invalid HTTP method');
    });

    it('rejects port 0 out of range with 400 Validation Error', async () => {
      const res = await request(app)
        .post('/api/v1/proxy-request')
        .send({ url: 'http://localhost:0/api' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation Error');
      expect(res.body.message).toContain('out of range');
    });

    it('rejects port > 65535 with 400 Invalid URL', async () => {
      const res = await request(app)
        .post('/api/v1/proxy-request')
        .send({ url: 'http://localhost:70000/api' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid URL');
    });

    it('rejects targeting reserved platform port 3000 on localhost with 400', async () => {
      const res = await request(app)
        .post('/api/v1/proxy-request')
        .send({ url: 'http://localhost:3000/api/tickets' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Reserved Port');
      expect(res.body.reservedPort).toBe(3000);
      expect(res.body.message).toContain('Port 3000 is reserved');
    });

    it('rejects SSRF cloud metadata endpoint with 403', async () => {
      const res = await request(app)
        .post('/api/v1/proxy-request')
        .send({ url: 'http://169.254.169.254/latest/meta-data' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });

    it('returns structured 502 with ECONNREFUSED diagnostics when target port is not listening', async () => {
      const res = await request(app)
        .post('/api/v1/proxy-request')
        .send({ url: 'http://127.0.0.1:39871/api/tickets', method: 'GET' });
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('Target Server Not Reachable');
      expect(res.body.code).toBe('ECONNREFUSED');
      expect(res.body.targetPort).toBe(39871);
      expect(res.body.troubleshooting).toBeDefined();
      expect(Array.isArray(res.body.troubleshooting)).toBe(true);
    });

    it('successfully proxies request to active developer server on port 3001+', async () => {
      const http = require('http');
      const testServer = http.createServer((req: any, res: any) => {
        if (req.url === '/api/test' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Developer API live' }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => testServer.listen(3456, '127.0.0.1', () => resolve()));

      try {
        const res = await request(app)
          .post('/api/v1/proxy-request')
          .send({
            url: 'http://127.0.0.1:3456/api/test',
            method: 'GET',
          });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe(200);
        expect(res.body.isJson).toBe(true);
        expect(res.body.data).toEqual({ success: true, message: 'Developer API live' });
        expect(res.body.durationMs).toBeGreaterThanOrEqual(0);
      } finally {
        await new Promise<void>((resolve) => testServer.close(() => resolve()));
      }
    });

    it('successfully proxies relative URL using X-Target-Port header', async () => {
      const http = require('http');
      const testServer = http.createServer((req: any, res: any) => {
        if (req.url === '/api/relative' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ relativeResolved: true }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => testServer.listen(3457, '127.0.0.1', () => resolve()));

      try {
        const res = await request(app)
          .post('/api/v1/proxy-request')
          .set('X-Target-Port', '3457')
          .send({
            url: '/api/relative',
            method: 'GET',
          });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe(200);
        expect(res.body.data).toEqual({ relativeResolved: true });
      } finally {
        await new Promise<void>((resolve) => testServer.close(() => resolve()));
      }
    });
  });

  describe('POST /api/v1/detect-endpoints', () => {
    it('scans and returns discovered endpoints from project files', async () => {
      const res = await request(app)
        .post('/api/v1/detect-endpoints')
        .send({
          entryFile: 'server.js',
          files: [
            {
              path: 'server.js',
              content: `
                const express = require('express');
                const app = express();
                app.get('/api/users', (req, res) => res.json([]));
                app.post('/api/users', (req, res) => res.json({}));
                app.listen(3001);
              `,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.endpoints).toBeDefined();
      expect(res.body.endpoints.length).toBe(2);
      expect(res.body.detectedPort).toBe(3001);
      expect(res.body.endpoints.some((e: any) => e.path === '/api/users' && e.method === 'GET')).toBe(true);
      expect(res.body.endpoints.some((e: any) => e.path === '/api/users' && e.method === 'POST')).toBe(true);
    });

    it('rejects empty file payload with 400', async () => {
      const res = await request(app)
        .post('/api/v1/detect-endpoints')
        .send({ files: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation Error');
    });
  });
});

