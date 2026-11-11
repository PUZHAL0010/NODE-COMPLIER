import { ExecutionProcessor } from '../../server/processor';
import { ProcessSandboxRuntime } from '../../server/sandbox/ProcessSandboxRuntime';
import { PreviewService } from '../../server/services/previewService';
import { JobStatus, ExecutionJob } from '../../shared/types';
import { resolveExecutionLimits } from '../../server/utils/limits';
import { validateProjectFiles, FileValidationError } from '../../server/validation/fileValidation';

describe('Acceptance Tests 1 - 10 (Full Specification Verification)', () => {
  let processor: ExecutionProcessor;

  beforeAll(() => {
    // Instantiate processor with process sandbox for deterministic test execution
    processor = new ExecutionProcessor(new ProcessSandboxRuntime());
  });

  const createTestJob = (entryFile: string, files: { path: string; content: string }[], timeoutMs = 5000): ExecutionJob => {
    return {
      jobId: `test-job-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      projectId: 'test-project',
      entryFile,
      files,
      userId: 'test-user',
      traceId: 'test-trace',
      enqueuedAt: Date.now(),
      limits: resolveExecutionLimits({ timeoutMs }),
    };
  };

  /**
   * Test 1 — JavaScript Execution & JSON Output Detection
   */
  it('Test 1 — executes JavaScript and captures structured JSON output', async () => {
    const job = createTestJob('index.js', [
      {
        path: 'index.js',
        content: `
          const data = {
            status: "SUCCESS",
            exitCode: 0
          };
          console.log("Execution Output:", JSON.stringify(data));
        `,
      },
    ]);

    const result = await processor.processJob(job);

    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Execution Output:');
    expect(result.jsonOutput).toEqual({ status: 'SUCCESS', exitCode: 0 });
  });

  /**
   * Test 2 — Runtime Error Handling
   */
  it('Test 2 — handles intentional runtime exception and captures stderr', async () => {
    const job = createTestJob('index.js', [
      {
        path: 'index.js',
        content: `throw new Error("Intentional failure");`,
      },
    ]);

    const result = await processor.processJob(job);

    expect(result.status).toBe(JobStatus.RUNTIME_ERROR);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Intentional failure');
  });

  /**
   * Test 3 — Infinite Loop Blocking & Timeout Termination
   */
  it('Test 3a — blocks unconditional infinite loops (while(true) and for(;;)) without execution', async () => {
    // 1. Verify while(true) blocking
    const whileJob = createTestJob('index.js', [
      {
        path: 'index.js',
        content: `while (true) {}`,
      },
    ]);
    const whileResult = await processor.processJob(whileJob);
    expect(whileResult.status).toBe(JobStatus.COMPILATION_ERROR);
    expect(whileResult.exitCode).toBe(1);
    expect(whileResult.stderr).toContain('Potential infinite loop detected: "while(true)"');

    // 2. Verify for(;;) blocking
    const forJob = createTestJob('index.js', [
      {
        path: 'index.js',
        content: `for (;;) {}`,
      },
    ]);
    const forResult = await processor.processJob(forJob);
    expect(forResult.status).toBe(JobStatus.COMPILATION_ERROR);
    expect(forResult.exitCode).toBe(1);
    expect(forResult.stderr).toContain('Potential infinite loop detected: "for(;;)"');
  });

  it('Test 3 — terminates long-running process on timeout within configured threshold', async () => {
    // Set 1500ms timeout for test speed
    const job = createTestJob(
      'index.js',
      [
        {
          path: 'index.js',
          content: `setInterval(() => {}, 500);`,
        },
      ],
      1500
    );

    const result = await processor.processJob(job);

    expect(result.status).toBe(JobStatus.TIMEOUT);
  });

  /**
   * Test 4 — TypeScript Compilation & Execution
   */
  it('Test 4 — compiles TypeScript source and executes generated JavaScript', async () => {
    const job = createTestJob('index.ts', [
      {
        path: 'index.ts',
        content: `
          const message: string = "Hello TypeScript";
          console.log(message);
        `,
      },
    ]);

    const result = await processor.processJob(job);

    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Hello TypeScript');
  });

  /**
   * Test 5 — TypeScript Compilation Error Diagnostics
   */
  it('Test 5 — returns COMPILATION_ERROR with structured diagnostics on type mismatch', async () => {
    const job = createTestJob('index.ts', [
      {
        path: 'index.ts',
        content: `const value: number = "invalid";`,
      },
    ]);

    const result = await processor.processJob(job);

    expect(result.status).toBe(JobStatus.COMPILATION_ERROR);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].file).toContain('index.ts');
    expect(result.errors[0].message.toLowerCase()).toContain("string");
  });

  /**
   * Test 6 — Multi-File Local Module Resolution
   */
  it('Test 6 — resolves local imports between index.js and utils.js', async () => {
    const job = createTestJob('index.js', [
      {
        path: 'index.js',
        content: `
          import { add } from './utils.js';
          console.log('Result is:', add(20, 22));
        `,
      },
      {
        path: 'utils.js',
        content: `
          export function add(a, b) {
            return a + b;
          }
        `,
      },
    ]);

    const result = await processor.processJob(job);

    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Result is: 42');
  });

  /**
   * Test 7 — HTML Preview Bundle & Security Armor
   */
  it('Test 7 — generates preview bundle with inlined assets and CSP armor', () => {
    const files = [
      {
        path: 'index.html',
        content: `
          <!DOCTYPE html>
          <html>
          <head>
            <link rel="stylesheet" href="style.css">
          </head>
          <body>
            <h1>Hello Preview</h1>
            <script src="app.js"></script>
          </body>
          </html>
        `,
      },
      {
        path: 'style.css',
        content: `h1 { color: blue; }`,
      },
      {
        path: 'app.js',
        content: `console.log('preview script running');`,
      },
    ];

    const bundle = PreviewService.generateBundle(files, 'index.html');

    expect(bundle.bundledHtml).toContain('<style data-inlined-from="style.css">');
    expect(bundle.bundledHtml).toContain('h1 { color: blue; }');
    expect(bundle.bundledHtml).toContain('<script data-inlined-from="app.js">');
    expect(bundle.bundledHtml).toContain("Content-Security-Policy");
    expect(bundle.bundledHtml).toContain("Object.defineProperty(window, 'parent'");
  });

  /**
   * Test 8 — Path Traversal Attempt
   */
  it('Test 8 — rejects path traversal attempts with ../', () => {
    const files = [
      {
        path: '../../secret.txt',
        content: 'secret',
      },
    ];

    expect(() => validateProjectFiles(files, '../../secret.txt')).toThrow(FileValidationError);
  });

  /**
   * Test 9 — Network Isolation / Error on Restricted Network
   */
  it('Test 9 — handles fetch/network call gracefully without host network breach', async () => {
    const job = createTestJob('index.js', [
      {
        path: 'index.js',
        content: `
          try {
            fetch("https://example.com").catch(e => {
              console.log('Network blocked:', e.message);
            });
          } catch(e) {
            console.log('Fetch error:', e.message);
          }
        `,
      },
    ]);

    const result = await processor.processJob(job);
    expect(result.status).toBe(JobStatus.SUCCESS);
  });

  /**
   * Test 10 — Cancellation Idempotency
   */
  it('Test 10 — supports idempotent cancellation requests', async () => {
    const runtime = new ProcessSandboxRuntime();
    const job = createTestJob('index.js', [{ path: 'index.js', content: 'console.log("hi");' }]);
    const sandbox = await runtime.create(job);

    await expect(runtime.cancel(sandbox)).resolves.not.toThrow();
    await expect(runtime.cancel(sandbox)).resolves.not.toThrow();

    await runtime.destroy(sandbox);
  });

  /**
   * Test 11 — React App.jsx Compilation & Execution
   */
  it('Test 11 — compiles and executes React App.jsx without extension errors', async () => {
    const files = [
      {
        path: 'App.jsx',
        content: `
          import React from "react";

          function App() {
            const name = "Pugal";
            return (
              <div>
                <h1>Hello {name}</h1>
                <p>JSX is working successfully!</p>
              </div>
            );
          }

          console.log("React App component created successfully");
          export default App;
        `,
      },
    ];

    const job = createTestJob('App.jsx', files);
    const result = await processor.processJob(job);

    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.stdout).toContain('React App component created successfully');

    // Also verify PreviewService bundle contains React runtime and App component
    const bundle = PreviewService.generateBundle(files, 'index.html');
    expect(bundle.bundledHtml).toContain('react.production.min.js');
    expect(bundle.bundledHtml).toContain('ReactDOM');
    expect(bundle.bundledHtml).toContain('Hello');
  });

  /**
   * Test 12 — Multi-File React Component Bundle (App.jsx, Header.jsx, Button.jsx)
   */
  it('Test 12 — generates preview bundle with resolved multi-file React dependencies', () => {
    const files = [
      {
        path: 'App.jsx',
        content: `
          import React from "react";
          import Header from "./Header";
          import Button from "./Button";

          function App() {
            return (
              <div>
                <Header />
                <h1>Hello React</h1>
                <Button />
              </div>
            );
          }

          export default App;
        `,
      },
      {
        path: 'Header.jsx',
        content: `
          import React from "react";
          function Header() {
            return <h2>Header Component</h2>;
          }
          export default Header;
        `,
      },
      {
        path: 'Button.jsx',
        content: `
          import React from "react";
          function Button() {
            return <button>Click Me</button>;
          }
          export default Button;
        `,
      },
    ];

    const bundle = PreviewService.generateBundle(files);
    expect(bundle.bundledHtml).toContain('Header Component');
    expect(bundle.bundledHtml).toContain('Hello React');
    expect(bundle.bundledHtml).toContain('Click Me');
    expect(bundle.bundledHtml).toContain('__defineModule');
  });

  /**
   * TEST-NODE-JS-001 & TEST-NODE-JS-002 (Primary Regression Test for Language Routing)
   */
  it('TEST-NODE-JS-001 — executes pure JavaScript without invoking TypeScript compiler', async () => {
    const job = createTestJob('index.js', [
      {
        path: 'index.js',
        content: 'console.log("Hello world");',
      },
    ]);

    const result = await processor.processJob(job);
    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('Hello world');
    expect(result.stderr).not.toContain('Cannot find global type');
    expect(result.stderr).not.toContain('Cannot write file');
    expect(result.metrics.compileDurationMs).toBe(0); // 0ms because TS compiler is bypassed
  });

  it('TEST-NODE-JS-002 — executes Array.map JavaScript correctly', async () => {
    const job = createTestJob('index.js', [
      {
        path: 'index.js',
        content: `
          const users = [1, 2, 3];
          console.log(users.map(x => x * 2));
        `,
      },
    ]);

    const result = await processor.processJob(job);
    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[ 2, 4, 6 ]');
    expect(result.stderr).not.toContain('Cannot find global type');
  });

  /**
   * TEST-TYPESCRIPT-001 & TEST-TYPESCRIPT-002
   */
  it('TEST-TYPESCRIPT-001 — executes valid TypeScript with standard library resolution', async () => {
    const job = createTestJob('index.ts', [
      {
        path: 'index.ts',
        content: `
          const message: string = "Hello TypeScript Standard Lib";
          const items: Array<number> = [1, 2, 3];
          console.log(message, items.length);
        `,
      },
    ]);

    const result = await processor.processJob(job);
    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Hello TypeScript Standard Lib 3');
  });

  it('TEST-TYPESCRIPT-002 — captures type error as COMPILATION_ERROR', async () => {
    const job = createTestJob('index.ts', [
      {
        path: 'index.ts',
        content: `
          const value: number = "this is a string";
        `,
      },
    ]);

    const result = await processor.processJob(job);
    expect(result.status).toBe(JobStatus.COMPILATION_ERROR);
    expect(result.exitCode).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  /**
   * TEST-MULTI-FILE-JS-001
   */
  it('TEST-MULTI-FILE-JS-001 — executes multi-file CommonJS require correctly', async () => {
    const job = createTestJob('index.js', [
      {
        path: 'index.js',
        content: `
          const { add } = require('./math');
          console.log(add(10, 20));
        `,
      },
      {
        path: 'math.js',
        content: `
          function add(a, b) {
            return a + b;
          }
          module.exports = { add };
        `,
      },
    ]);

    const result = await processor.processJob(job);
    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.stdout.trim()).toBe('30');
  });

  /**
   * TEST-ESM-JS-001
   */
  it('TEST-ESM-JS-001 — executes ES Modules with package.json type: module', async () => {
    const job = createTestJob('index.js', [
      {
        path: 'package.json',
        content: JSON.stringify({ name: 'esm-test', type: 'module' }),
      },
      {
        path: 'index.js',
        content: `
          import { add } from './math.js';
          console.log(add(10, 20));
        `,
      },
      {
        path: 'math.js',
        content: `
          export function add(a, b) {
            return a + b;
          }
        `,
      },
    ]);

    const result = await processor.processJob(job);
    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.stdout.trim()).toBe('30');
  });

  /**
   * TEST-JSON-DATA-001
   */
  it('TEST-JSON-DATA-001 — reads and imports JSON data files correctly', async () => {
    const job = createTestJob('index.js', [
      {
        path: 'index.js',
        content: `
          const config = require('./config.json');
          console.log(config.appName, config.port);
        `,
      },
      {
        path: 'config.json',
        content: JSON.stringify({ appName: 'NodeCompilerApp', port: 8080 }),
      },
    ]);

    const result = await processor.processJob(job);
    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.stdout).toContain('NodeCompilerApp 8080');
  });

  /**
   * TEST-EJS-EXEC-001 — Server-side EJS compilation & rendering
   */
  it('TEST-EJS-EXEC-001 — compiles and renders .ejs template using ejs package', async () => {
    const job = createTestJob('server.js', [
      {
        path: 'server.js',
        content: `
          const ejs = require('ejs');
          const fs = require('fs');
          const template = fs.readFileSync('views/index.ejs', 'utf8');
          const rendered = ejs.render(template, { user: 'Alice', role: 'Engineer' });
          console.log('RENDERED_EJS:', rendered.trim());
        `,
      },
      {
        path: 'views/index.ejs',
        content: `
          <div class="user-card">
            <h1>Welcome, <%= user %>!</h1>
            <p>Role: <%= role %></p>
          </div>
        `,
      },
    ]);

    const result = await processor.processJob(job);
    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.stdout).toContain('Welcome, Alice!');
    expect(result.stdout).toContain('Role: Engineer');
  });

  /**
   * TEST-EJS-PREVIEW-001 — PreviewService generates bundle for .ejs templates
   */
  it('TEST-EJS-PREVIEW-001 — PreviewService generates bundle from .ejs and inlines CSS', () => {
    const files = [
      {
        path: 'views/index.ejs',
        content: '<h1><%= title %></h1><p><%= message %></p>',
      },
      {
        path: 'styles.css',
        content: 'h1 { color: purple; }',
      },
    ];

    const bundle = PreviewService.generateBundle(files, 'views/index.ejs');
    expect(bundle.bundledHtml).toContain('Node.js Application');
    expect(bundle.bundledHtml).toContain('h1 { color: purple; }');
  });

  /**
   * TEST-JS-INNERHTML-PREVIEW-001 — PreviewService detects and bundles HTML/CSS from .js file
   */
  it('TEST-JS-INNERHTML-PREVIEW-001 — PreviewService extracts and styles HTML from .js file', () => {
    const files = [
      {
        path: 'server.js',
        content: `
          const express = require('express');
          const app = express();
          app.get('/', (req, res) => {
            res.send('<section class="hero"><h1>Server-Side Rendered Hero</h1></section>');
          });
        `,
      },
      {
        path: 'style.css',
        content: '.hero { background: navy; }',
      },
    ];

    const bundle = PreviewService.generateBundle(files, 'server.js');
    expect(bundle.bundledHtml).toContain('Server-Side Rendered Hero');
    expect(bundle.bundledHtml).toContain('.hero { background: navy; }');
  });

  /**
   * TEST-JS-INNERHTML-DOM-001 — JavaScript with document.getElementById and innerHTML executes in Node.js
   */
  it('TEST-JS-INNERHTML-DOM-001 — JavaScript with document.getElementById and innerHTML executes in Node.js', async () => {
    const job = createTestJob('index.js', [
      {
        path: 'index.js',
        content: `
          const card = document.getElementById('card');
          card.innerHTML = '<h2>Interactive Card</h2><p>Rendered with innerHTML</p>';
          console.log('INNER_HTML_OUTPUT:', card.innerHTML);
          console.log('OUTER_HTML_OUTPUT:', card.outerHTML);
        `,
      },
    ]);

    const result = await processor.processJob(job);
    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('INNER_HTML_OUTPUT: <h2>Interactive Card</h2><p>Rendered with innerHTML</p>');
    expect(result.stdout).toContain('OUTER_HTML_OUTPUT: <div id="card"><h2>Interactive Card</h2><p>Rendered with innerHTML</p></div>');
    expect(result.htmlPreviewBundle).toBeDefined();
    expect((result.htmlPreviewBundle as any).bundledHtml).toContain('runProjectScripts');
  });

  /**
   * TEST-JS-INNERHTML-AUTO-RUN-001 — PreviewService auto-runs vanilla JS modules so innerHTML updates preview DOM
   */
  it('TEST-JS-INNERHTML-AUTO-RUN-001 — PreviewService auto-runs vanilla JS modules so innerHTML updates preview DOM', () => {
    const files = [
      {
        path: 'index.html',
        content: '<div id="output">Waiting...</div>',
      },
      {
        path: 'app.js',
        content: 'document.getElementById("output").innerHTML = "<h1>Updated via app.js innerHTML</h1>";',
      },
    ];

    const bundle = PreviewService.generateBundle(files, 'index.html');
    expect(bundle.bundledHtml).toContain('runProjectScripts');
    expect(bundle.bundledHtml).toContain('app.js');
    expect(bundle.bundledHtml).toContain('window.__require');
  });
});


