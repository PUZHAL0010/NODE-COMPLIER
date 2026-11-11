import { scanProjectEndpoints } from '../../server/validation/endpointScanner';

describe('Endpoint & Route Scanner', () => {
  it('discovers Express REST endpoints and methods', () => {
    const files = [
      {
        path: 'server.js',
        content: `
          const express = require('express');
          const app = express();
          const PORT = process.env.PORT || 3001;

          app.get('/', (req, res) => res.send('OK'));
          app.get('/api/users', (req, res) => res.json([]));
          app.post('/api/users', (req, res) => res.status(201).json(req.body));
          app.put('/api/users/:id', (req, res) => res.json({}));
          app.delete('/api/users/:id', (req, res) => res.status(204).end());

          app.listen(PORT, () => console.log('Listening'));
        `,
      },
    ];

    const result = scanProjectEndpoints(files, 'server.js');
    expect(result.endpoints.length).toBe(5);
    expect(result.detectedPort).toBe(3001);
    expect(result.framework).toBe('Express');

    const getRoot = result.endpoints.find((e) => e.method === 'GET' && e.path === '/');
    expect(getRoot).toBeDefined();

    const postUser = result.endpoints.find((e) => e.method === 'POST' && e.path === '/api/users');
    expect(postUser).toBeDefined();
    expect(postUser?.sampleBody).toBeDefined();
    expect(postUser?.sampleBody).toHaveProperty('name');

    const deleteUser = result.endpoints.find((e) => e.method === 'DELETE' && e.path === '/api/users/:id');
    expect(deleteUser).toBeDefined();
  });

  it('discovers native Node http.createServer endpoints', () => {
    const files = [
      {
        path: 'index.js',
        content: `
          const http = require('http');
          const server = http.createServer((req, res) => {
            if (req.url === '/health') {
              res.end('healthy');
            } else if (req.url === '/api/data') {
              res.end('{}');
            }
          });
          server.listen(4000);
        `,
      },
    ];

    const result = scanProjectEndpoints(files, 'index.js');
    expect(result.detectedPort).toBe(4000);
    expect(result.endpoints.some((e) => e.path === '/health')).toBe(true);
    expect(result.endpoints.some((e) => e.path === '/api/data')).toBe(true);
  });

  it('handles multi-file projects and prioritizes entry file', () => {
    const files = [
      {
        path: 'routes/items.js',
        content: `
          const express = require('express');
          const router = express.Router();
          router.get('/api/items', (req, res) => res.json([]));
          router.post('/api/items', (req, res) => res.status(201).json({}));
          module.exports = router;
        `,
      },
      {
        path: 'server.js',
        content: `
          const express = require('express');
          const app = express();
          const itemsRouter = require('./routes/items');
          app.get('/healthz', (req, res) => res.send('ok'));
          app.use(itemsRouter);
          app.listen(5000);
        `,
      },
    ];

    const result = scanProjectEndpoints(files, 'server.js');
    expect(result.detectedPort).toBe(5000);
    expect(result.endpoints.some((e) => e.path === '/healthz')).toBe(true);
    expect(result.endpoints.some((e) => e.path === '/api/items' && e.method === 'GET')).toBe(true);
    expect(result.endpoints.some((e) => e.path === '/api/items' && e.method === 'POST')).toBe(true);
  });

  it('provides fallback root endpoint if server listens but has dynamic routes', () => {
    const files = [
      {
        path: 'app.js',
        content: `
          const express = require('express');
          const app = express();
          const PORT = 3005;
          app.listen(PORT);
        `,
      },
    ];

    const result = scanProjectEndpoints(files, 'app.js');
    expect(result.detectedPort).toBe(3005);
    expect(result.endpoints.length).toBeGreaterThan(0);
    expect(result.endpoints[0].path).toBe('/');
  });
});
