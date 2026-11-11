/**
 * AST-Based Static Security Analyzer
 * Defense-in-depth scanner that inspects JavaScript/TypeScript source for dangerous patterns.
 * NOTE: This is NOT the primary security boundary; full isolation occurs in the sandbox.
 */

import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { ProjectFile, SecurityViolation } from '../../shared/types';
import { logger } from '../utils/logger';

const RESTRICTED_BUILTIN_MODULES = new Set([
  'child_process',
  'cluster',
  'worker_threads',
  'vm',
  'v8',
  'inspector',
]);

const RESTRICTED_PROCESS_METHODS = new Set([
  'kill',
  'abort',
  'dlopen',
  'binding',
  '_linkedBinding',
  '_rawDebug',
  'reallyExit',
]);

function isAlwaysTruthy(testNode: any): boolean {
  if (!testNode) {
    // for (;;) has test === null/undefined, which is always true in JS/TS
    return true;
  }
  if (testNode.type === 'BooleanLiteral' && testNode.value === true) {
    return true;
  }
  if (testNode.type === 'NumericLiteral' && testNode.value !== 0) {
    return true;
  }
  if (testNode.type === 'StringLiteral' && testNode.value.length > 0) {
    return true;
  }
  if (
    testNode.type === 'UnaryExpression' &&
    testNode.operator === '!' &&
    testNode.argument.type === 'NumericLiteral' &&
    testNode.argument.value === 0
  ) {
    return true;
  }
  return false;
}

function hasLoopExit(loopPath: any): boolean {
  let loopLabel: string | null = null;
  if (loopPath.parentPath?.isLabeledStatement()) {
    loopLabel = loopPath.parentPath.node.label.name;
  }

  const body = loopPath.get('body');
  if (!body || !body.node) return false;

  let hasExit = false;

  body.traverse({
    Function(innerFuncPath: any) {
      // Returns or breaks inside nested functions/callbacks do NOT exit the outer loop
      innerFuncPath.skip();
    },

    BreakStatement(breakPath: any) {
      if (hasExit) return;
      const label = breakPath.node.label?.name;
      if (label) {
        if (loopLabel && label === loopLabel) {
          hasExit = true;
          breakPath.stop();
        }
      } else {
        const enclosing = breakPath.findParent((p: any) => p.isLoop() || p.isSwitchStatement());
        if (enclosing === loopPath) {
          hasExit = true;
          breakPath.stop();
        }
      }
    },

    ReturnStatement(returnPath: any) {
      if (hasExit) return;
      hasExit = true;
      returnPath.stop();
    },

    ThrowStatement(throwPath: any) {
      if (hasExit) return;
      hasExit = true;
      throwPath.stop();
    },

    CallExpression(callPath: any) {
      if (hasExit) return;
      const { callee } = callPath.node;
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'process' &&
        callee.property.type === 'Identifier' &&
        (callee.property.name === 'exit' || callee.property.name === 'abort')
      ) {
        hasExit = true;
        callPath.stop();
      }
    },
  });

  return hasExit;
}

/**
 * Scan all JavaScript/TypeScript files in a project for suspicious patterns
 */
export function scanProjectAst(files: ProjectFile[]): SecurityViolation[] {
  const violations: SecurityViolation[] = [];

  for (const file of files) {
    // Only analyze JS, TS, JSX, and TSX files
    if (!/\.(js|mjs|cjs|ts|tsx|jsx)$/i.test(file.path)) {
      continue;
    }

    try {
      const isTs = file.path.endsWith('.ts') || file.path.endsWith('.tsx');
      const ast = parse(file.content, {
        sourceType: 'unambiguous',
        plugins: isTs ? ['typescript', 'jsx'] : ['jsx'],
        errorRecovery: true,
      });

      const portsAssigned3000 = new Set<string>();

      traverse(ast, {
        // Track variable declarations assigning 3000 (e.g. const PORT = 3000, let port = 3000)
        VariableDeclarator(pathNode) {
          const { id, init } = pathNode.node;
          if (id.type === 'Identifier' && init) {
            const is3000 =
              (init.type === 'NumericLiteral' && init.value === 3000) ||
              (init.type === 'StringLiteral' && init.value === '3000');
            if (is3000) {
              portsAssigned3000.add(id.name);
              if (/port/i.test(id.name)) {
                violations.push({
                  file: file.path,
                  rule: 'RESERVED_PORT_3000',
                  message: 'Port 3000 is strictly reserved for the Code Editor web platform. Please choose any other port (e.g., 3001, 3002, 4000, 5000, 8000, 8080) or use process.env.PORT.',
                  line: pathNode.node.loc?.start.line,
                  column: pathNode.node.loc?.start.column,
                });
              }
            }
          }
        },

        AssignmentExpression(pathNode) {
          const { left, right } = pathNode.node;
          if (left.type === 'Identifier' && right) {
            const is3000 =
              (right.type === 'NumericLiteral' && right.value === 3000) ||
              (right.type === 'StringLiteral' && right.value === '3000');
            if (is3000) {
              portsAssigned3000.add(left.name);
              if (/port/i.test(left.name)) {
                violations.push({
                  file: file.path,
                  rule: 'RESERVED_PORT_3000',
                  message: 'Port 3000 is strictly reserved for the Code Editor web platform. Please choose any other port (e.g., 3001, 3002, 4000, 5000, 8000, 8080) or use process.env.PORT.',
                  line: pathNode.node.loc?.start.line,
                  column: pathNode.node.loc?.start.column,
                });
              }
            }
          }
        },

        // Infinite Loop Detection: for(;;), while(true), do..while(true) without exit condition
        WhileStatement(pathNode) {
          if (isAlwaysTruthy(pathNode.node.test) && !hasLoopExit(pathNode)) {
            violations.push({
              file: file.path,
              rule: 'INFINITE_LOOP_DETECTED',
              message: 'Potential infinite loop detected: "while(true)" without terminating condition (break, return, or throw) will cause the process to hang indefinitely. Compilation and execution blocked by compiler.',
              line: pathNode.node.loc?.start.line,
              column: pathNode.node.loc?.start.column,
            });
          }
        },

        ForStatement(pathNode) {
          if (isAlwaysTruthy(pathNode.node.test) && !hasLoopExit(pathNode)) {
            const isOmittedTest = !pathNode.node.test;
            const loopDesc = isOmittedTest ? 'for(;;)' : 'for(; true; )';
            violations.push({
              file: file.path,
              rule: 'INFINITE_LOOP_DETECTED',
              message: `Potential infinite loop detected: "${loopDesc}" without terminating condition (break, return, or throw) will cause the process to hang indefinitely. Compilation and execution blocked by compiler.`,
              line: pathNode.node.loc?.start.line,
              column: pathNode.node.loc?.start.column,
            });
          }
        },

        DoWhileStatement(pathNode) {
          if (isAlwaysTruthy(pathNode.node.test) && !hasLoopExit(pathNode)) {
            violations.push({
              file: file.path,
              rule: 'INFINITE_LOOP_DETECTED',
              message: 'Potential infinite loop detected: "do ... while(true)" without terminating condition (break, return, or throw) will cause the process to hang indefinitely. Compilation and execution blocked by compiler.',
              line: pathNode.node.loc?.start.line,
              column: pathNode.node.loc?.start.column,
            });
          }
        },
        // 1. Check require('...') and import ... from '...'
        CallExpression(pathNode) {
          const { callee, arguments: args } = pathNode.node;

          // Check require(...)
          if (
            callee.type === 'Identifier' &&
            callee.name === 'require' &&
            args.length > 0 &&
            args[0].type === 'StringLiteral'
          ) {
            const moduleName = args[0].value;
            if (RESTRICTED_BUILTIN_MODULES.has(moduleName)) {
              violations.push({
                file: file.path,
                rule: 'RESTRICTED_MODULE_REQUIRE',
                message: `Importing native module "${moduleName}" is restricted.`,
                line: pathNode.node.loc?.start.line,
                column: pathNode.node.loc?.start.column,
              });
            }
          }

          // Check dynamic eval(...) or Function(...)
          if (callee.type === 'Identifier' && callee.name === 'eval') {
            violations.push({
              file: file.path,
              rule: 'DYNAMIC_EVAL_USAGE',
              message: 'Direct invocation of eval() detected.',
              line: pathNode.node.loc?.start.line,
              column: pathNode.node.loc?.start.column,
            });
          }

          // Check process.kill(), process.dlopen(), etc.
          if (
            callee.type === 'MemberExpression' &&
            callee.object.type === 'Identifier' &&
            callee.object.name === 'process' &&
            callee.property.type === 'Identifier' &&
            RESTRICTED_PROCESS_METHODS.has(callee.property.name)
          ) {
            violations.push({
              file: file.path,
              rule: 'DANGEROUS_PROCESS_CALL',
              message: `Invocation of restricted process method "process.${callee.property.name}()".`,
              line: pathNode.node.loc?.start.line,
              column: pathNode.node.loc?.start.column,
            });
          }

          // Check listen(3000) or listen(PORT) where PORT is 3000
          if (
            callee.type === 'MemberExpression' &&
            callee.property.type === 'Identifier' &&
            callee.property.name === 'listen' &&
            args.length > 0
          ) {
            const firstArg = args[0];
            const isDirect3000 =
              (firstArg.type === 'NumericLiteral' && firstArg.value === 3000) ||
              (firstArg.type === 'StringLiteral' && firstArg.value === '3000');
            const isVar3000 = firstArg.type === 'Identifier' && portsAssigned3000.has(firstArg.name);

            if (isDirect3000 || isVar3000) {
              if (!violations.some((v) => v.rule === 'RESERVED_PORT_3000' && v.line === pathNode.node.loc?.start.line)) {
                violations.push({
                  file: file.path,
                  rule: 'RESERVED_PORT_3000',
                  message: 'Port 3000 is strictly reserved for the Code Editor web platform. Please choose any other port (e.g., 3001, 3002, 4000, 5000, 8080) or use process.env.PORT.',
                  line: pathNode.node.loc?.start.line,
                  column: pathNode.node.loc?.start.column,
                });
              }
            }
          }
        },

        // 2. Check static ES module imports: import x from 'child_process'
        ImportDeclaration(pathNode) {
          const sourceValue = pathNode.node.source.value;
          if (RESTRICTED_BUILTIN_MODULES.has(sourceValue)) {
            violations.push({
              file: file.path,
              rule: 'RESTRICTED_MODULE_IMPORT',
              message: `Importing native module "${sourceValue}" is restricted.`,
              line: pathNode.node.loc?.start.line,
              column: pathNode.node.loc?.start.column,
            });
          }
        },

        // 3. Check dynamic imports: import('...')
        Import(pathNode) {
          const parent = pathNode.parentPath;
          if (parent?.isCallExpression()) {
            const arg = parent.node.arguments[0];
            if (arg && arg.type === 'StringLiteral' && RESTRICTED_BUILTIN_MODULES.has(arg.value)) {
              violations.push({
                file: file.path,
                rule: 'RESTRICTED_DYNAMIC_IMPORT',
                message: `Dynamic import of "${arg.value}" is restricted.`,
                line: parent.node.loc?.start.line,
                column: parent.node.loc?.start.column,
              });
            }
          }
        },

        // 4. Check prototype pollution attempts
        MemberExpression(pathNode) {
          const prop = pathNode.node.property;
          if (
            (prop.type === 'Identifier' && prop.name === '__proto__') ||
            (prop.type === 'StringLiteral' && prop.value === '__proto__')
          ) {
            violations.push({
              file: file.path,
              rule: 'PROTOTYPE_POLLUTION_PATTERN',
              message: 'Direct assignment or access to __proto__ detected.',
              line: pathNode.node.loc?.start.line,
              column: pathNode.node.loc?.start.column,
            });
          }
        },

        // String literals inspection for sensitive OS paths (TCS iON / Linux security policy)
        StringLiteral(pathNode) {
          const val = pathNode.node.value;
          if (
            typeof val === 'string' &&
            (/\/(etc\/(shadow|passwd|sudoers)|proc\/|sys\/)/i.test(val) ||
             /system32[\\/]config[\\/]sam/i.test(val))
          ) {
            violations.push({
              file: file.path,
              rule: 'RESTRICTED_SYSTEM_RESOURCE',
              message: `Access to restricted system path "${val}" is prohibited by TCS iON / Linux security policy.`,
              line: pathNode.node.loc?.start.line,
              column: pathNode.node.loc?.start.column,
            });
          }
        },
      });
    } catch (err: unknown) {
      logger.warn({ file: file.path, err }, 'AST parser encountered non-fatal parsing warning');
    }
  }

  return violations;
}
