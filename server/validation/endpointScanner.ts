/**
 * AST & Semantic Endpoint Scanner
 * Discovers REST endpoints, HTTP routes, methods, and listening ports
 * from user Node.js code (Express, Fastify, Koa, Hono, native http.createServer).
 */

import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { ProjectFile } from '../../shared/types';
import { logger } from '../utils/logger';

export interface DiscoveredEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS' | 'ALL';
  path: string;
  file: string;
  line?: number;
  sampleBody?: Record<string, unknown> | null;
  description?: string;
}

export interface EndpointScanResult {
  endpoints: DiscoveredEndpoint[];
  detectedPort?: number;
  framework?: string;
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'all']);

/**
 * Generate intelligent sample JSON request body based on route path
 */
function generateSampleBody(method: string, routePath: string): Record<string, unknown> | null {
  if (!['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
    return null;
  }

  const lower = routePath.toLowerCase();

  if (lower.includes('user') || lower.includes('auth') || lower.includes('login') || lower.includes('signup')) {
    return {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'Engineer',
    };
  }

  if (lower.includes('product') || lower.includes('item') || lower.includes('order')) {
    return {
      title: 'Sample Item',
      price: 29.99,
      category: 'Electronics',
      quantity: 1,
    };
  }

  if (lower.includes('todo') || lower.includes('task') || lower.includes('ticket')) {
    return {
      title: 'Implement new feature',
      status: 'pending',
      priority: 'high',
    };
  }

  if (lower.includes('message') || lower.includes('chat') || lower.includes('comment')) {
    return {
      content: 'Hello from Thunder Client!',
      author: 'Developer',
    };
  }

  return {
    title: 'Example Payload',
    description: 'Auto-generated request payload from endpoint scanner',
    active: true,
  };
}

/**
 * Scan project files for HTTP routes and port declarations
 */
export function scanProjectEndpoints(files: ProjectFile[], entryFile = 'index.js'): EndpointScanResult {
  const endpoints: DiscoveredEndpoint[] = [];
  const seen = new Set<string>();
  let detectedPort: number | undefined;
  let framework = 'Node.js';

  // Sort so entryFile is analyzed first
  const sortedFiles = [...files].sort((a, b) => {
    if (a.path === entryFile) return -1;
    if (b.path === entryFile) return 1;
    return 0;
  });

  for (const file of sortedFiles) {
    if (!/\.(js|mjs|cjs|ts|tsx|jsx)$/i.test(file.path)) {
      continue;
    }

    const content = file.content;
    const isTs = file.path.endsWith('.ts') || file.path.endsWith('.tsx');

    // 1. AST Traversal pass
    try {
      const ast = parse(content, {
        sourceType: 'unambiguous',
        plugins: isTs ? ['typescript', 'jsx'] : ['jsx'],
        errorRecovery: true,
      });

      traverse(ast, {
        CallExpression(pathNode) {
          const { callee, arguments: args } = pathNode.node;

          // Express / Fastify / Koa / Router method calls: app.get('/users', ...), router.post(...)
          if (callee.type === 'MemberExpression') {
            const propName = callee.property.type === 'Identifier' ? callee.property.name.toLowerCase() : '';

            // Route handler calls: get, post, put, delete, etc.
            if (HTTP_METHODS.has(propName) && args.length >= 2) {
              const firstArg = args[0];
              let routePath: string | null = null;

              if (firstArg.type === 'StringLiteral') {
                routePath = firstArg.value;
              } else if (firstArg.type === 'TemplateLiteral' && firstArg.quasis.length > 0) {
                routePath = firstArg.quasis.map((q) => q.value.raw).join(':param');
              }

              if (routePath && routePath.startsWith('/')) {
                const methodUpper = propName.toUpperCase() as DiscoveredEndpoint['method'];
                const key = `${methodUpper} ${routePath}`;

                if (!seen.has(key)) {
                  seen.add(key);
                  endpoints.push({
                    method: methodUpper,
                    path: routePath,
                    file: file.path,
                    line: pathNode.node.loc?.start.line,
                    sampleBody: generateSampleBody(methodUpper, routePath),
                  });
                }

                if (framework === 'Node.js') {
                  framework = 'Express';
                }
              }
            }

            // Port detection: app.listen(3001) or app.listen(PORT, ...)
            if (propName === 'listen' && args.length > 0) {
              const portArg = args[0];
              if (portArg.type === 'NumericLiteral') {
                detectedPort = portArg.value;
              } else if (portArg.type === 'Identifier') {
                // Check if variable PORT is declared in the file
                const portMatch = content.match(/(?:PORT|port)\s*=\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d{4,5})/);
                if (portMatch && portMatch[1]) {
                  detectedPort = parseInt(portMatch[1], 10);
                }
              } else if (portArg.type === 'LogicalExpression' && portArg.operator === '||') {
                if (portArg.right.type === 'NumericLiteral') {
                  detectedPort = portArg.right.value;
                }
              }
            }
          }
        },

        // Native Node http.createServer: if (req.url === '/path') or switch (req.url)
        BinaryExpression(pathNode) {
          const { left, operator, right } = pathNode.node;
          if (operator === '===' || operator === '==') {
            const isReqUrl =
              (left.type === 'MemberExpression' &&
                left.object.type === 'Identifier' &&
                (left.object.name === 'req' || left.object.name === 'request') &&
                left.property.type === 'Identifier' &&
                left.property.name === 'url') ||
              (left.type === 'Identifier' && (left.name === 'url' || left.name === 'pathname'));

            if (isReqUrl && right.type === 'StringLiteral' && right.value.startsWith('/')) {
              const routePath = right.value;
              const key = `GET ${routePath}`;
              if (!seen.has(key)) {
                seen.add(key);
                endpoints.push({
                  method: 'GET',
                  path: routePath,
                  file: file.path,
                  line: pathNode.node.loc?.start.line,
                  sampleBody: null,
                });
              }
            }
          }
        },
      });
    } catch (parseErr) {
      logger.debug({ file: file.path, err: parseErr }, 'AST parsing error during endpoint scan, using regex fallback');
    }

    // 2. Regex fallback pass (guarantees finding routes even during syntax errors while typing)
    const routeRegex = /(?:app|router|server|api)\.(get|post|put|delete|patch|head|options|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    let match: RegExpExecArray | null;
    while ((match = routeRegex.exec(content)) !== null) {
      const methodUpper = match[1].toUpperCase() as DiscoveredEndpoint['method'];
      const routePath = match[2];
      if (routePath.startsWith('/')) {
        const key = `${methodUpper} ${routePath}`;
        if (!seen.has(key)) {
          seen.add(key);
          endpoints.push({
            method: methodUpper,
            path: routePath,
            file: file.path,
            sampleBody: generateSampleBody(methodUpper, routePath),
          });
        }
      }
    }

    // Regex fallback for port binding if not detected by AST
    if (!detectedPort) {
      const listenPortMatch = content.match(/\.listen\s*\(\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d{4,5})/);
      if (listenPortMatch && listenPortMatch[1]) {
        detectedPort = parseInt(listenPortMatch[1], 10);
      } else {
        const envPortMatch = content.match(/(?:const|let|var)\s+(?:PORT|port)\s*=\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d{4,5})/);
        if (envPortMatch && envPortMatch[1]) {
          detectedPort = parseInt(envPortMatch[1], 10);
        }
      }
    }
  }

  // If no routes detected but server listen is called, at least provide root endpoint
  if (endpoints.length === 0 && detectedPort) {
    endpoints.push({
      method: 'GET',
      path: '/',
      file: entryFile,
      sampleBody: null,
    });
  }

  return {
    endpoints,
    detectedPort: detectedPort || 3001,
    framework,
  };
}
