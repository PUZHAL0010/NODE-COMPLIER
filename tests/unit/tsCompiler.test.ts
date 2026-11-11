import { compileTypeScriptProject } from '../../server/compiler/tsCompiler';

describe('TypeScript Compilation Engine', () => {
  it('compiles valid TypeScript source into JavaScript', () => {
    const files = [
      {
        path: 'app.ts',
        content: `
          const greeting: string = "Hello TypeScript";
          console.log(greeting);
        `,
      },
    ];

    const result = compileTypeScriptProject(files, 'app.ts');
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.compiledEntryFile).toBe('app.js');

    const jsFile = result.files.find((f) => f.path === 'app.js');
    expect(jsFile).toBeDefined();
    expect(jsFile?.content).toContain('console.log(greeting)');
  });

  it('captures structured diagnostics on type error', () => {
    const files = [
      {
        path: 'app.ts',
        content: `
          const value: number = "this is not a number";
        `,
      },
    ];

    const result = compileTypeScriptProject(files, 'app.ts');
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);

    const firstError = result.errors[0];
    expect(firstError.file).toContain('app.ts');
    expect(firstError.line).toBeGreaterThanOrEqual(1);
    expect(firstError.message).toContain("Type 'string' is not assignable to type 'number'");
  });

  it('handles multi-file TypeScript imports', () => {
    const files = [
      {
        path: 'main.ts',
        content: `
          import { add } from './math';
          console.log(add(5, 10));
        `,
      },
      {
        path: 'math.ts',
        content: `
          export function add(a: number, b: number): number {
            return a + b;
          }
        `,
      },
    ];

    const result = compileTypeScriptProject(files, 'main.ts');
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.files.some((f) => f.path === 'main.js')).toBe(true);
    expect(result.files.some((f) => f.path === 'math.js')).toBe(true);
  });

  it('compiles single-file React App.jsx with React.createElement and JSX expressions', () => {
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

          export default App;
        `,
      },
    ];

    const result = compileTypeScriptProject(files, 'App.jsx');
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.compiledEntryFile).toBe('App.js');

    const appJs = result.files.find((f) => f.path === 'App.js');
    expect(appJs).toBeDefined();
    expect(appJs?.content).toContain('React.createElement');
    expect(appJs?.content).toContain('Hello ');
  });

  it('compiles multi-file React components (App.jsx, Header.jsx, Button.jsx)', () => {
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

    const result = compileTypeScriptProject(files, 'App.jsx');
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.files.some((f) => f.path === 'App.js')).toBe(true);
    expect(result.files.some((f) => f.path === 'Header.js')).toBe(true);
    expect(result.files.some((f) => f.path === 'Button.js')).toBe(true);
  });

  it('captures structured line and column diagnostics for invalid JSX without crashing', () => {
    const files = [
      {
        path: 'App.jsx',
        content: `
          import React from "react";

          function App() {
            return (
              <div>
                <h1>Hello
              </div>
            );
          }

          export default App;
        `,
      },
    ];

    const result = compileTypeScriptProject(files, 'App.jsx');
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);

    const firstError = result.errors[0];
    expect(['App.jsx', 'global']).toContain(firstError.file);
    expect(firstError.line).toBeGreaterThanOrEqual(1);
    expect(firstError.column).toBeGreaterThanOrEqual(1);
  });
});
