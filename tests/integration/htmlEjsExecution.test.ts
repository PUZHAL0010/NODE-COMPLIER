import { ExecutionProcessor } from '../../server/processor';
import { ProcessSandboxRuntime } from '../../server/sandbox/ProcessSandboxRuntime';
import { JobStatus, ExecutionJob } from '../../shared/types';
import { resolveExecutionLimits } from '../../server/utils/limits';

describe('HTML, CSS, EJS & Multi-Language Execution Integration Tests', () => {
  let processor: ExecutionProcessor;

  beforeAll(() => {
    processor = new ExecutionProcessor(new ProcessSandboxRuntime());
  });

  const createTestJob = (entryFile: string, files: { path: string; content: string }[], timeoutMs = 5000): ExecutionJob => {
    return {
      jobId: `test-job-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      projectId: `test-project-${Date.now()}`,
      entryFile,
      files,
      userId: 'test-user',
      traceId: 'test-trace',
      enqueuedAt: Date.now(),
      limits: resolveExecutionLimits({ timeoutMs }),
    };
  };

  it('compiles and executes valid HTML file with preview bundle', async () => {
    const job = createTestJob('index.html', [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html>
<head><title>Test App</title></head>
<body>
  <div id="root"><h1>Hello Universal IDE</h1></div>
</body>
</html>`,
      },
    ]);

    const result = await processor.processJob(job);
    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[WEB_PREVIEW_PIPELINE]');
    expect(result.htmlPreviewBundle).toBeDefined();
    expect((result.htmlPreviewBundle as any).bundledHtml).toContain('Hello Universal IDE');
  });

  it('detects and blocks HTML files with syntax errors', async () => {
    const job = createTestJob('index.html', [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html>
<head>
  <script>
    const a = ; // syntax error!
  </script>
</head>
<body></body>
</html>`,
      },
    ]);

    const result = await processor.processJob(job);
    expect(result.status).toBe(JobStatus.COMPILATION_ERROR);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('HTML_JS_SYNTAX_ERROR');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('compiles and executes valid EJS template and outputs rendered HTML', async () => {
    const job = createTestJob('index.ejs', [
      {
        path: 'index.ejs',
        content: `<div>
  <h1><%= title %></h1>
  <p><%= message %></p>
  <ul>
    <% items.forEach(function(i) { %>
      <li><%= i %></li>
    <% }); %>
  </ul>
</div>`,
      },
    ]);

    const result = await processor.processJob(job);
    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[EJS_RENDER_PIPELINE]');
    expect(result.stdout).toContain('Express REST API');
    expect(result.htmlPreviewBundle).toBeDefined();
  });

  it('detects and blocks EJS files with syntax errors', async () => {
    const job = createTestJob('index.ejs', [
      {
        path: 'index.ejs',
        content: `<div>
  <h1><%= title</h1>
</div>`,
      },
    ]);

    const result = await processor.processJob(job);
    expect(result.status).toBe(JobStatus.COMPILATION_ERROR);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('EJS_UNCLOSED_DELIMITER');
  });

  it('handles missing module errors with helpful package hints', async () => {
    const job = createTestJob('index.js', [
      {
        path: 'index.js',
        content: `require('non_existent_special_library');`,
      },
    ]);

    const result = await processor.processJob(job);
    expect(result.status).toBe(JobStatus.RUNTIME_ERROR);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Package Resolution Hint');
    expect(result.stderr).toContain('express');
  });

  it('compiles standalone CSS file and generates interactive showcase preview', async () => {
    const job = createTestJob('styles.css', [
      {
        path: 'styles.css',
        content: `
          body { background: #0f172a; color: #f8fafc; font-family: sans-serif; }
          .card { background: #1e293b; border-radius: 8px; padding: 16px; }
          .btn-primary { background: #0284c7; color: white; border: none; padding: 8px 16px; }
        `,
      },
    ]);

    const result = await processor.processJob(job);
    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[WEB_PREVIEW_PIPELINE]');
    expect(result.htmlPreviewBundle).toBeDefined();
    const html = (result.htmlPreviewBundle as any).bundledHtml;
    expect(html).toContain('CSS Preview Showcase');
    expect(html).toContain('data-inlined-from="styles.css"');
    expect(html).toContain('.btn-primary');
  });

  it('detects and blocks CSS files with syntax errors and returns formatted diagnostics', async () => {
    const job = createTestJob('styles.css', [
      {
        path: 'styles.css',
        content: `
          body {
            background: #0f172a;
          /* unclosed curly brace and block
        `,
      },
    ]);

    const result = await processor.processJob(job);
    expect(result.status).toBe(JobStatus.COMPILATION_ERROR);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('CSS_UNCLOSED_BLOCK');
    expect(result.stderr).toContain('HTML/CSS Compiler Diagnostic');
  });
});
