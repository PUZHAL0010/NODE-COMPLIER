import { scanProjectAst } from '../../server/validation/astSecurityAnalyzer';

describe('AST Static Security Analyzer', () => {
  it('detects require() of restricted native modules', () => {
    const files = [
      {
        path: 'app.js',
        content: `
          const cp = require('child_process');
          cp.exec('ls');
        `,
      },
    ];

    const violations = scanProjectAst(files);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.rule === 'RESTRICTED_MODULE_REQUIRE')).toBe(true);
  });

  it('detects static ES module import of restricted modules', () => {
    const files = [
      {
        path: 'app.ts',
        content: `
          import * as worker from 'worker_threads';
          console.log(worker);
        `,
      },
    ];

    const violations = scanProjectAst(files);
    expect(violations.some((v) => v.rule === 'RESTRICTED_MODULE_IMPORT')).toBe(true);
  });

  it('detects direct eval() invocation', () => {
    const files = [
      {
        path: 'eval.js',
        content: `
          const code = 'console.log(1)';
          eval(code);
        `,
      },
    ];

    const violations = scanProjectAst(files);
    expect(violations.some((v) => v.rule === 'DYNAMIC_EVAL_USAGE')).toBe(true);
  });

  it('detects process.kill() invocations', () => {
    const files = [
      {
        path: 'kill.js',
        content: `
          process.kill(process.pid, 'SIGKILL');
        `,
      },
    ];

    const violations = scanProjectAst(files);
    expect(violations.some((v) => v.rule === 'DANGEROUS_PROCESS_CALL')).toBe(true);
  });

  it('detects prototype pollution pattern via __proto__', () => {
    const files = [
      {
        path: 'pollute.js',
        content: `
          const obj = {};
          obj['__proto__'].polluted = true;
        `,
      },
    ];

    const violations = scanProjectAst(files);
    expect(violations.some((v) => v.rule === 'PROTOTYPE_POLLUTION_PATTERN')).toBe(true);
  });

  it('passes clean standard code without violations', () => {
    const files = [
      {
        path: 'clean.js',
        content: `
          const numbers = [1, 2, 3, 4, 5];
          const doubled = numbers.map(n => n * 2);
          console.log(JSON.stringify(doubled));
        `,
      },
    ];

    const violations = scanProjectAst(files);
    expect(violations).toHaveLength(0);
  });

  it('detects unconditional while(true) infinite loop without exit', () => {
    const files = [
      {
        path: 'loop.js',
        content: `while (true) {}`,
      },
    ];

    const violations = scanProjectAst(files);
    expect(violations.some((v) => v.rule === 'INFINITE_LOOP_DETECTED')).toBe(true);
  });

  it('detects unconditional for(;;) infinite loop without exit', () => {
    const files = [
      {
        path: 'loop.js',
        content: `for (;;) { console.log("looping"); }`,
      },
    ];

    const violations = scanProjectAst(files);
    expect(violations.some((v) => v.rule === 'INFINITE_LOOP_DETECTED')).toBe(true);
  });

  it('detects unconditional while(1) infinite loop without exit', () => {
    const files = [
      {
        path: 'loop.js',
        content: `while (1) { doSomething(); }`,
      },
    ];

    const violations = scanProjectAst(files);
    expect(violations.some((v) => v.rule === 'INFINITE_LOOP_DETECTED')).toBe(true);
  });

  it('allows while(true) with explicit break statement', () => {
    const files = [
      {
        path: 'safe.js',
        content: `
          let i = 0;
          while (true) {
            i++;
            if (i > 5) break;
          }
        `,
      },
    ];

    const violations = scanProjectAst(files);
    expect(violations.some((v) => v.rule === 'INFINITE_LOOP_DETECTED')).toBe(false);
  });

  it('allows for(;;) with explicit break statement', () => {
    const files = [
      {
        path: 'safe.js',
        content: `
          for (;;) {
            if (Math.random() > 0.5) break;
          }
        `,
      },
    ];

    const violations = scanProjectAst(files);
    expect(violations.some((v) => v.rule === 'INFINITE_LOOP_DETECTED')).toBe(false);
  });

  it('allows while(true) with return statement inside enclosing function', () => {
    const files = [
      {
        path: 'safe.js',
        content: `
          function findTarget() {
            while (true) {
              return 42;
            }
          }
        `,
      },
    ];

    const violations = scanProjectAst(files);
    expect(violations.some((v) => v.rule === 'INFINITE_LOOP_DETECTED')).toBe(false);
  });

  it('detects while(true) when return is inside an inner callback function', () => {
    const files = [
      {
        path: 'leak.js',
        content: `
          while (true) {
            [1, 2, 3].forEach(() => {
              return;
            });
          }
        `,
      },
    ];

    const violations = scanProjectAst(files);
    expect(violations.some((v) => v.rule === 'INFINITE_LOOP_DETECTED')).toBe(true);
  });

  it('detects outer while(true) when break is only inside an inner loop', () => {
    const files = [
      {
        path: 'nested.js',
        content: `
          while (true) {
            for (let i = 0; i < 5; i++) {
              break;
            }
          }
        `,
      },
    ];

    const violations = scanProjectAst(files);
    expect(violations.some((v) => v.rule === 'INFINITE_LOOP_DETECTED')).toBe(true);
  });
});
