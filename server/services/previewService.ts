/**
 * HTML & React Preview Bundle Service
 * Inlines project CSS and JS assets, injects restrictive Content Security Policy (CSP),
 * provides a client-side micro-module loader for React/JSX, and mounts React apps.
 */

import { ProjectFile, PreviewBundle } from '../../shared/types';
import { compileTypeScriptProject } from '../compiler/tsCompiler';

/**
 * Safely stringify objects to be embedded directly inside HTML <script> tags.
 * Escapes < and > so </script> never terminates script execution prematurely.
 */
function safeJsonEmbed(obj: any): string {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export class PreviewService {
  private static readonly PREVIEW_CSP = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://unpkg.com https://cdn.jsdelivr.net https://cdn.tailwindcss.com https://esm.sh https://use.fontawesome.com https://kit.fontawesome.com",
    "style-src 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com https://cdn.jsdelivr.net https://fonts.googleapis.com https://use.fontawesome.com https://ka-f.fontawesome.com",
    "font-src data: https://fonts.gstatic.com https://cdnjs.cloudflare.com https://use.fontawesome.com https://ka-f.fontawesome.com https://cdn.jsdelivr.net",
    "img-src data: blob: https:",
    "connect-src 'self' http://localhost:* http://127.0.0.1:* https://unpkg.com https://cdn.jsdelivr.net https://esm.sh https://ka-f.fontawesome.com",
    "media-src data: blob: https:",
  ].join('; ');

  /**
   * Generates a self-contained HTML bundle from multi-file project sources (HTML/CSS/JS and React/JSX)
   */
  public static generateBundle(
    files: ProjectFile[],
    entryHtml = 'index.html',
    activeServerPort?: string | number
  ): PreviewBundle {
    const isReactProject = files.some(
      (f) =>
        /\.(jsx|tsx)$/i.test(f.path) ||
        (f.path === 'App.js' || f.path === 'App.jsx' || f.path === 'index.jsx') ||
        f.content.includes('import React') ||
        f.content.includes("from 'react'") ||
        f.content.includes('from "react"')
    );

    // 1. Transpile any TypeScript, TSX, and JSX files first
    const compilation = compileTypeScriptProject(files, entryHtml);
    const resolvedFiles = compilation.files;

    const fileMap = new Map<string, string>();
    for (const f of resolvedFiles) {
      fileMap.set(f.path, f.content);
    }

    const isCssTarget = entryHtml.endsWith('.css');
    let hasExistingHtml = !isCssTarget && fileMap.has(entryHtml);
    let htmlContent = hasExistingHtml ? (fileMap.get(entryHtml) || '') : '';

    if (isCssTarget) {
      const altHtml = Array.from(fileMap.keys()).find((k) => k.endsWith('.html') || k.endsWith('.htm'));
      if (altHtml) {
        hasExistingHtml = true;
        htmlContent = fileMap.get(altHtml) || '';
      }
    }

    const hasEjsTags = /<%[\s\S]*?%>/.test(htmlContent);
    const isEjsTarget = (fileMap.has(entryHtml) && (entryHtml.endsWith('.ejs') || hasEjsTags)) ||
      (!hasExistingHtml && Array.from(fileMap.keys()).some((k) => k.endsWith('.ejs') || /<%[\s\S]*?%>/.test(fileMap.get(k) || '')));

    // 1a. Check for EJS template files (.ejs) or HTML files containing EJS scriptlets
    if (isEjsTarget) {
      const targetEjs = (fileMap.has(entryHtml) && (entryHtml.endsWith('.ejs') || hasEjsTags))
        ? entryHtml
        : Array.from(fileMap.keys()).find((k) => k.endsWith('.ejs') || /<%[\s\S]*?%>/.test(fileMap.get(k) || ''))!;

      hasExistingHtml = true;
      const ejsTemplate = fileMap.get(targetEjs) || '';
      try {
        const ejs = require('ejs');
        const defaultContext: Record<string, any> = {
          title: 'Node.js Application',
          message: 'Server-Side Rendering Active',
          items: ['Buy groceries', 'Complete project', 'Review code'],
          tasks: ['Buy groceries', 'Complete project', 'Review code'],
          task: 'Complete project documentation',
          lastAddedTask: 'Complete project documentation',
          user: { name: 'Developer', role: 'admin', email: 'dev@example.com' },
          todos: ['Buy groceries', 'Complete project', 'Review code'],
          list: ['Buy groceries', 'Complete project', 'Review code'],
          data: ['Buy groceries', 'Complete project', 'Review code'],
          name: 'Developer',
          success: true,
          error: null,
        };

        const safeContext = new Proxy(defaultContext, {
          has() {
            return true;
          },
          get(target, prop) {
            if (typeof prop === 'string' && prop in target) {
              return target[prop];
            }
            if (prop === 'then' || typeof prop === 'symbol') {
              return undefined;
            }
            const fallback: any = ['Task 1', 'Task 2', 'Task 3'];
            fallback.toString = () => '';
            return fallback;
          },
        });

        htmlContent = ejs.render(ejsTemplate, safeContext);
      } catch {
        // Fallback: strip scriptlets if rendering throws so HTML tags remain viewable
        htmlContent = ejsTemplate.replace(/<%[=\-_]?[\s\S]*?%>/g, '');
      }
    }

    // 1b. Check if .js / .ts code serves or defines HTML (res.send, res.end, innerHTML, or template functions)
    if (!hasExistingHtml && !isReactProject) {
      for (const [filePath, content] of fileMap.entries()) {
        if (filePath.endsWith('.js') || filePath.endsWith('.ts')) {
          const doctypeMatch = content.match(/[`'"](<!DOCTYPE[\s\S]*?>[\s\S]*?<\/html>|<html[\s\S]*?>[\s\S]*?<\/html>)[`'"]/i) ||
                               content.match(/[`'"](<!DOCTYPE[\s\S]*?>[\s\S]*?)[`'"]/i);
          const sendMatch = content.match(/res\.(?:send|end)\s*\(\s*[`'"]([\s\S]*?<[a-z][\s\S]*?>[\s\S]*?)[`'"]\s*\)/i);
          const innerHtmlMatch = content.match(/(?:innerHTML|renderHtml|html)\s*=\s*[`'"]([\s\S]*?<[a-z][\s\S]*?>[\s\S]*?)[`'"]\s*/i);
          const returnMatch = content.match(/return\s*[`'"]([\s\S]*?<[a-z][\s\S]*?>[\s\S]*?)[`'"]\s*;/i);

          let matchedHtml = doctypeMatch?.[1] || sendMatch?.[1] || innerHtmlMatch?.[1] || returnMatch?.[1];
          if (matchedHtml) {
            matchedHtml = matchedHtml.replace(/\$\{[^}]*\}/g, '').trim();
            if (matchedHtml.toLowerCase().startsWith('<!doctype') && !matchedHtml.toLowerCase().includes('</html>')) {
              matchedHtml += '\n</html>';
            }
            hasExistingHtml = true;
            htmlContent = matchedHtml;
            break;
          }
        }
      }
    }

    // 1b-2. If no HTML found yet, check if project contains ANY .html file (e.g. sucess.html, form.html)
    if (!hasExistingHtml && !isReactProject) {
      const anyHtml = Array.from(fileMap.keys()).find((k) => k.endsWith('.html') || k.endsWith('.htm'));
      if (anyHtml) {
        hasExistingHtml = true;
        htmlContent = fileMap.get(anyHtml) || '';
      }
    }

    // 1c. If no index.html exists but React/JSX files are present, generate a clean React container
    if (!hasExistingHtml && isReactProject) {
      htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>React Preview</title>
</head>
<body>
  <div id="root"></div>
  <div id="app"></div>
  <div id="app-root"></div>
</body>
</html>`;
    } else if (!hasExistingHtml && isCssTarget) {
      htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CSS Preview Showcase</title>
</head>
<body>
  <div class="container preview-container" style="max-width: 800px; margin: 0 auto; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <header class="header" style="margin-bottom: 24px; text-align: center;">
      <h1 class="title">CSS Preview Showcase</h1>
      <p class="subtitle">Live preview of your stylesheet rules and UI components</p>
    </header>
    <main class="content">
      <section class="card" style="margin-bottom: 20px; padding: 20px; border-radius: 8px;">
        <h2>Typography & Actions</h2>
        <p>This is sample content styled with your active CSS classes and tag selectors. <strong>Bold text</strong>, <em>italic text</em>, and <a href="#" class="link">interactive link</a>.</p>
        <div style="margin-top: 12px; display: flex; gap: 10px;">
          <button class="btn btn-primary" type="button">Primary Button</button>
          <button class="btn btn-secondary" type="button">Secondary Button</button>
        </div>
      </section>
      <section class="card" style="margin-bottom: 20px; padding: 20px; border-radius: 8px;">
        <h2>Form Controls</h2>
        <form class="form" onsubmit="event.preventDefault()">
          <div class="form-group" style="margin-bottom: 12px;">
            <label for="sample-input" style="display: block; margin-bottom: 4px;">Input Field</label>
            <input type="text" id="sample-input" class="input" placeholder="Type here..." value="Sample text" style="padding: 8px; width: 100%; max-width: 300px;">
          </div>
          <div class="form-group">
            <label for="sample-select" style="display: block; margin-bottom: 4px;">Select Menu</label>
            <select id="sample-select" class="select" style="padding: 8px;">
              <option>Option 1</option>
              <option>Option 2</option>
            </select>
          </div>
        </form>
      </section>
      <section class="card" style="margin-bottom: 20px; padding: 20px; border-radius: 8px;">
        <h2>List Elements</h2>
        <ul class="list">
          <li class="list-item">List item 1 <span class="badge">Active</span></li>
          <li class="list-item">List item 2 <span class="badge">Success</span></li>
        </ul>
      </section>
    </main>
  </div>
  <div id="root"></div>
  <div id="app"></div>
  <div id="app-root"></div>
  <div id="output"></div>
  <div id="demo"></div>
  <div id="container"></div>
  <div id="content"></div>
</body>
</html>`;
    } else if (!hasExistingHtml) {
      htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Application Preview</title>
</head>
<body>
  <div id="root"></div>
  <div id="app"></div>
  <div id="app-root"></div>
  <div id="output"></div>
  <div id="demo"></div>
  <div id="container"></div>
  <div id="content"></div>
</body>
</html>`;
    } else if (!/<!DOCTYPE|<html|<body/i.test(htmlContent)) {
      // Wrap bare HTML fragments or innerHTML into a valid HTML document
      htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Application Preview</title>
</head>
<body>
  <div id="app-root">${htmlContent}</div>
  <div id="root"></div>
  <div id="app"></div>
  <div id="output"></div>
  <div id="demo"></div>
  <div id="container"></div>
  <div id="content"></div>
</body>
</html>`;
    }

    // 1d. Auto-inline all project CSS files if not already linked
    let projectStyles = '';
    for (const [p, cssData] of fileMap.entries()) {
      if (p.endsWith('.css') && !htmlContent.includes(`data-inlined-from="${p}"`)) {
        projectStyles += `<style data-inlined-from="${p}">\n${cssData}\n</style>\n`;
      }
    }
    if (projectStyles) {
      if (htmlContent.includes('</head>')) {
        htmlContent = htmlContent.replace('</head>', `${projectStyles}</head>`);
      } else if (htmlContent.includes('<body')) {
        htmlContent = htmlContent.replace(/<body[^>]*>/, `$&${projectStyles}`);
      } else {
        htmlContent = `${projectStyles}${htmlContent}`;
      }
    }

    // 2. Inline CSS linked via <link rel="stylesheet" href="...">
    htmlContent = htmlContent.replace(
      /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi,
      (match, href) => {
        const cleanHref = href.replace(/^\.\//, '');
        const cssContent = fileMap.get(cleanHref);
        if (cssContent !== undefined) {
          return `<style data-inlined-from="${cleanHref}">\n${cssContent}\n</style>`;
        }
        return match;
      }
    );

    // 3. Inline JavaScript linked via <script src="..."></script>
    htmlContent = htmlContent.replace(
      /<script\s+[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
      (match, src) => {
        let cleanSrc = src.replace(/^\.\//, '');
        cleanSrc = cleanSrc.replace(/\.(ts|tsx|jsx)$/i, '.js');
        const jsContent = fileMap.get(cleanSrc);
        if (jsContent !== undefined) {
          const safeJs = jsContent.replace(/<\/script/gi, '<\\/script');
          return `<script data-inlined-from="${cleanSrc}">\n${safeJs}\n</script>`;
        }
        return match;
      }
    );

    // 4. Build Multi-Page Virtual HTML map
    const virtualPages: Record<string, string> = {};
    for (const file of resolvedFiles) {
      if (file.path.endsWith('.html') || file.path.endsWith('.ejs') || file.path.endsWith('.htm')) {
        let pageHtml = file.content;
        if (file.path.endsWith('.ejs') || /<%[\s\S]*?%>/.test(pageHtml)) {
          try {
            const ejs = require('ejs');
            const defaultContext: Record<string, any> = {
              title: 'Node.js Application',
              message: 'Server-Side Rendering Active',
              items: ['Buy groceries', 'Complete project', 'Review code'],
              tasks: ['Buy groceries', 'Complete project', 'Review code'],
              task: 'Complete project documentation',
              lastAddedTask: 'Complete project documentation',
              user: { name: 'Developer', role: 'admin', email: 'dev@example.com' },
              todos: ['Buy groceries', 'Complete project', 'Review code'],
              list: ['Buy groceries', 'Complete project', 'Review code'],
              data: ['Buy groceries', 'Complete project', 'Review code'],
              name: 'Developer',
              success: true,
              error: null,
            };
            const safeContext = new Proxy(defaultContext, {
              has() { return true; },
              get(target, prop) {
                if (typeof prop === 'string' && prop in target) return target[prop];
                if (prop === 'then' || typeof prop === 'symbol') return undefined;
                const fallback: any = ['Task 1', 'Task 2', 'Task 3'];
                fallback.toString = () => '';
                return fallback;
              },
            });
            pageHtml = ejs.render(pageHtml, safeContext);
          } catch {
            pageHtml = pageHtml.replace(/<%[=\-_]?[\s\S]*?%>/g, '');
          }
        }

        const resolveAsset = (assetPath: string) => {
          const clean = assetPath.replace(/^\.\//, '').replace(/^\//, '');
          if (fileMap.has(clean)) return fileMap.get(clean);
          if (fileMap.has('public/' + clean)) return fileMap.get('public/' + clean);
          if (fileMap.has('public/css/' + clean)) return fileMap.get('public/css/' + clean);
          if (fileMap.has('public/js/' + clean)) return fileMap.get('public/js/' + clean);
          const baseName = clean.split('/').pop();
          if (baseName && fileMap.has(baseName)) return fileMap.get(baseName);
          return undefined;
        };

        pageHtml = pageHtml.replace(
          /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi,
          (match, href) => {
            const cssContent = resolveAsset(href);
            return cssContent !== undefined ? `<style data-inlined-from="${href}">\n${cssContent}\n</style>` : match;
          }
        );
        pageHtml = pageHtml.replace(
          /<script\s+[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi,
          (match, src) => {
            let cleanSrc = src.replace(/\.(ts|tsx|jsx)$/i, '.js');
            const jsContent = resolveAsset(cleanSrc);
            const safeJs = jsContent !== undefined ? jsContent.replace(/<\/script/gi, '<\\/script') : '';
            return jsContent !== undefined ? `<script data-inlined-from="${src}">\n${safeJs}\n</script>` : match;
          }
        );

        virtualPages[file.path] = pageHtml;
        virtualPages['/' + file.path] = pageHtml;
        const baseName = file.path.replace(/\.(html|ejs|htm)$/i, '');
        virtualPages[baseName] = pageHtml;
        virtualPages['/' + baseName] = pageHtml;

        // If file is inside views/ directory, also map without views/ prefix
        if (file.path.startsWith('views/')) {
          const viewStripped = file.path.replace(/^views\//, '');
          virtualPages[viewStripped] = pageHtml;
          virtualPages['/' + viewStripped] = pageHtml;
          const viewBase = viewStripped.replace(/\.(html|ejs|htm)$/i, '');
          virtualPages[viewBase] = pageHtml;
          virtualPages['/' + viewBase] = pageHtml;
        }

        // Alias success.html <-> sucess.html
        if (file.path.includes('sucess')) {
          virtualPages['success.html'] = pageHtml;
          virtualPages['/success.html'] = pageHtml;
          virtualPages['success'] = pageHtml;
          virtualPages['/success'] = pageHtml;
        } else if (file.path.includes('success')) {
          virtualPages['sucess.html'] = pageHtml;
          virtualPages['/sucess.html'] = pageHtml;
          virtualPages['sucess'] = pageHtml;
          virtualPages['/sucess'] = pageHtml;
        }

        if (file.path === 'index.html' || file.path === 'index.ejs' || file.path === 'views/index.html' || file.path === 'views/index.ejs') {
          virtualPages['/'] = pageHtml;
          virtualPages[''] = pageHtml;
        }
      }
    }

    // 5. Prepare Multi-File Module Registry for JS / JSX / TSX
    let moduleRegistryScripts = '';
    if (isReactProject || resolvedFiles.some((f) => f.path.endsWith('.js'))) {
      const moduleEntries: { name: string; code: string }[] = [];
      for (const file of resolvedFiles) {
        if (file.path.endsWith('.js')) {
          moduleEntries.push({
            name: file.path,
            code: file.content,
          });
        }
      }

      moduleRegistryScripts = `
  <script>
    (function() {
      window.__MODULES__ = {};
      window.__MODULE_CACHE__ = {};

      window.__defineModule = function(name, fn) {
        window.__MODULES__[name] = fn;
      };

      window.__require = function(id) {
        if (id === 'react' || id === 'React') return window.React;
        if (id === 'react-dom' || id === 'ReactDOM') return window.ReactDOM;
        if (id === 'react-dom/client') return window.ReactDOM;
        if (id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') return window.React;

        var clean = id.replace(/^\\.\\//, '');
        var candidates = [
          id,
          clean,
          './' + clean,
          clean + '.js',
          './' + clean + '.js',
          clean + '.jsx',
          './' + clean + '.jsx',
          clean + '.tsx',
          './' + clean + '.tsx'
        ];

        for (var i = 0; i < candidates.length; i++) {
          var key = candidates[i];
          if (window.__MODULE_CACHE__[key]) {
            return window.__MODULE_CACHE__[key].exports;
          }
          if (window.__MODULES__[key]) {
            var mod = { exports: {} };
            window.__MODULE_CACHE__[key] = mod;
            window.__MODULES__[key](mod.exports, window.__require, mod);
            return mod.exports;
          }
        }
        console.warn("Module not found in preview registry:", id);
        return {};
      };
    })();
  </script>
`;

      for (const entry of moduleEntries) {
        const safeCode = entry.code.replace(/<\/script/gi, '<\\/script');
        moduleRegistryScripts += `
  <script>
    window.__defineModule(${JSON.stringify(entry.name)}, function(exports, require, module) {
      ${safeCode}
    });
    window.__defineModule(${JSON.stringify('./' + entry.name)}, function(exports, require, module) {
      ${safeCode}
    });
    window.__defineModule(${JSON.stringify(entry.name.replace(/\\.js$/, ''))}, function(exports, require, module) {
      ${safeCode}
    });
    window.__defineModule(${JSON.stringify('./' + entry.name.replace(/\\.js$/, ''))}, function(exports, require, module) {
      ${safeCode}
    });
  </script>
`;
      }

      if (isReactProject) {
        moduleRegistryScripts += `
  <script>
    window.addEventListener('DOMContentLoaded', function() {
      try {
        var rootElement = document.getElementById('root') || document.body;
        if (!document.getElementById('root')) {
          var newRoot = document.createElement('div');
          newRoot.id = 'root';
          document.body.appendChild(newRoot);
          rootElement = newRoot;
        }

        var AppComp = null;
        var candidates = ['./App.js', 'App.js', './App', 'App', './index.js', 'index.js'];
        for (var i = 0; i < candidates.length; i++) {
          try {
            var res = window.__require(candidates[i]);
            if (res) {
              AppComp = res.default || res.App || res;
              if (typeof AppComp === 'function' || (typeof AppComp === 'object' && AppComp !== null)) break;
            }
          } catch(e) {}
        }

        if (AppComp && window.React && window.ReactDOM) {
          if (window.ReactDOM.createRoot) {
            window.ReactDOM.createRoot(rootElement).render(window.React.createElement(AppComp));
          } else {
            window.ReactDOM.render(window.React.createElement(AppComp), rootElement);
          }
        }
      } catch(err) {
        console.error('React rendering error:', err);
        var errBox = document.createElement('div');
        errBox.style = 'color: #ef4444; background: #fee2e2; border: 1px solid #f87171; padding: 12px; border-radius: 6px; font-family: monospace; margin: 16px;';
        errBox.innerHTML = '<strong>React Rendering Error:</strong> ' + err.message;
        document.body.appendChild(errBox);
      }
    });
  </script>
`;
      } else {
        // Plain JavaScript / DOM manipulation project: auto-run entry script(s) so innerHTML and DOM code executes!
        moduleRegistryScripts += `
  <script>
    (function() {
      function runProjectScripts() {
        // Ensure standard container fallbacks exist for DOM operations & innerHTML
        var defaultContainers = ['root', 'app', 'app-root', 'output', 'demo', 'container', 'content', 'box'];
        for (var i = 0; i < defaultContainers.length; i++) {
          var cid = defaultContainers[i];
          if (!document.getElementById(cid)) {
            var el = document.createElement('div');
            el.id = cid;
            (document.getElementById('app-root') || document.body || document.documentElement).appendChild(el);
          }
        }

        // Auto-fallback on document.getElementById to never return null when setting innerHTML
        var _origGetById = document.getElementById.bind(document);
        document.getElementById = function(id) {
          var found = _origGetById(id);
          if (!found && id && typeof id === 'string') {
            found = document.createElement('div');
            found.id = id;
            (document.getElementById('app-root') || document.getElementById('root') || document.body || document.documentElement).appendChild(found);
          }
          return found;
        };

        // Execute candidate JavaScript entry modules so innerHTML and DOM code runs
        var candidates = [
          ${JSON.stringify(entryHtml.replace(/\.(html|ejs|htm)$/i, '.js'))},
          './index.js', 'index.js',
          './app.js', 'app.js',
          './script.js', 'script.js',
          './main.js', 'main.js'
        ];
        var executed = false;
        for (var c = 0; c < candidates.length; c++) {
          var cName = candidates[c];
          if (window.__MODULES__[cName] && !window.__MODULE_CACHE__[cName]) {
            try {
              window.__require(cName);
              executed = true;
              break;
            } catch(err) {
              console.error('Script execution error (' + cName + '):', err);
            }
          }
        }

        // If no candidate matched but modules exist, run available non-prefixed module
        if (!executed) {
          var allModules = Object.keys(window.__MODULES__);
          for (var m = 0; m < allModules.length; m++) {
            var modName = allModules[m];
            if (!modName.startsWith('./') && window.__MODULES__[modName] && !window.__MODULE_CACHE__[modName]) {
              try {
                window.__require(modName);
                break;
              } catch(e) {}
            }
          }
        }
      }

      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', runProjectScripts);
      } else {
        runProjectScripts();
      }
    })();
  </script>
`;
      }
    }

    // 6. Security Armor & React Scripts
    const reactCdnScripts = isReactProject
      ? `
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"></script>
`
      : '';

    const securityArmor = `
  <meta http-equiv="Content-Security-Policy" content="${this.PREVIEW_CSP}">
  ${reactCdnScripts}
  <script>
    (function() {
      var _top = window.parent;

      function reportPreviewError(msg, line, col, source) {
        try {
          var existing = document.getElementById('__preview_error_banner__');
          if (!existing) {
            var banner = document.createElement('div');
            banner.id = '__preview_error_banner__';
            banner.style = 'position:fixed;top:10px;left:10px;right:10px;z-index:999999;background:#18181b;border:1px solid #ef4444;border-left:5px solid #ef4444;color:#fca5a5;padding:12px 16px;border-radius:6px;font-family:monospace;font-size:13px;line-height:1.5;box-shadow:0 10px 25px rgba(0,0,0,0.6);';
            var closeBtn = '<button onclick="this.parentElement.remove()" style="float:right;background:none;border:none;color:#ef4444;font-size:18px;cursor:pointer;font-weight:bold;margin-left:10px;line-height:1;">&times;</button>';
            banner.innerHTML = closeBtn + '<strong style="color:#ef4444;display:block;margin-bottom:4px;font-size:14px;">⚠️ Preview Runtime Exception:</strong>' +
              '<div style="word-break:break-all;color:#fff;font-weight:500;">' + String(msg) + '</div>' +
              '<div style="margin-top:6px;font-size:11px;color:#94a3b8;">Source: ' + (source || 'inline script') + (line ? (' | Line: ' + line + (col ? ':' + col : '')) : '') + '</div>';
            (document.body || document.documentElement).appendChild(banner);
          }
          if (_top && _top !== window) {
            _top.postMessage({ type: 'preview_error', message: String(msg), line: line, col: col, source: source }, '*');
          }
        } catch(e) {}
      }

      window.onerror = function(msg, url, lineNo, columnNo, error) {
        reportPreviewError(msg, lineNo, columnNo, url);
        return false;
      };

      window.addEventListener('unhandledrejection', function(event) {
        var reason = event.reason ? (event.reason.message || event.reason) : 'Unknown Promise Error';
        reportPreviewError('Unhandled Promise Rejection: ' + reason, 0, 0, 'Promise');
      });

      // Forward preview console messages to parent IDE
      var origErr = console.error;
      var origLog = console.log;
      console.error = function() {
        origErr.apply(console, arguments);
        try {
          var str = Array.from(arguments).map(function(a) { return typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' ');
          reportPreviewError(str, 0, 0, 'console.error');
          if (_top && _top !== window) {
            _top.postMessage({ type: 'preview_console', level: 'stderr', data: str }, '*');
          }
        } catch(e) {}
      };
      console.log = function() {
        origLog.apply(console, arguments);
        try {
          if (_top && _top !== window) {
            var str = Array.from(arguments).map(function(a) { return typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' ');
            _top.postMessage({ type: 'preview_console', level: 'stdout', data: str }, '*');
          }
        } catch(e) {}
      };

      // In-memory isolated storage mock so client scripts can use sessionStorage/localStorage
      var __storageMock = {};
      var mockStorage = {
        getItem: function(k) { return __storageMock[k] !== undefined ? __storageMock[k] : null; },
        setItem: function(k, v) { __storageMock[k] = String(v); },
        removeItem: function(k) { delete __storageMock[k]; },
        clear: function() { __storageMock = {}; }
      };
      try {
        Object.defineProperty(window, 'parent', { get: () => window });
        Object.defineProperty(window, 'top', { get: () => window });
        Object.defineProperty(document, 'cookie', { get: () => '', set: () => {} });
        Object.defineProperty(window, 'localStorage', { get: () => mockStorage });
        Object.defineProperty(window, 'sessionStorage', { get: () => mockStorage });
      } catch (e) {}

      window.__VIRTUAL_PAGES__ = ${safeJsonEmbed(virtualPages)};
      window.__ACTIVE_SERVER_PORT__ = ${safeJsonEmbed(activeServerPort ? String(activeServerPort) : null)};

      // Helper to navigate between virtual pages
      window.navigateTo = function(rawUrl) {
        var clean = String(rawUrl).replace(/^\.\//, '');
        var pageKey = clean.split('?')[0].replace(/^\//, '');
        var pageHtml = window.__VIRTUAL_PAGES__[clean] ||
                       window.__VIRTUAL_PAGES__['/' + clean] ||
                       window.__VIRTUAL_PAGES__[pageKey] ||
                       window.__VIRTUAL_PAGES__['/' + pageKey] ||
                       window.__VIRTUAL_PAGES__['views/' + pageKey] ||
                       window.__VIRTUAL_PAGES__['views/' + pageKey + '.html'] ||
                       window.__VIRTUAL_PAGES__[pageKey + '.html'];

        if (_top && _top !== window) {
          _top.postMessage({ type: 'preview_navigated', url: clean.startsWith('/') ? clean : ('/' + clean) }, '*');
        }

        if (pageHtml) {
          document.open();
          document.write(pageHtml);
          document.close();
          return true;
        }
        return false;
      };

      // 1. Intercept fetch() so relative API requests (/validate-email, /api/items) route directly to user's server
      var _nativeFetch = window.fetch.bind(window);
      window.fetch = function(resource, init) {
        var url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
        var activePort = window.__ACTIVE_SERVER_PORT__ || '3001';

        if (typeof url === 'string') {
          // Leave IDE platform endpoints untouched
          if (!url.startsWith('/api/v1/') && !url.startsWith('/api/v1')) {
            if (url.startsWith('/')) {
              url = 'http://localhost:' + activePort + url;
            } else if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:') && !url.startsWith('blob:')) {
              url = 'http://localhost:' + activePort + '/' + url.replace(/^\.\//, '');
            }
          }
          if (typeof resource === 'string') {
            resource = url;
          } else if (resource && resource.url) {
            try {
              resource = new Request(url, init || resource);
            } catch(e) {
              resource = url;
            }
          }
        }

        return _nativeFetch(resource, init).catch(function(fetchErr) {
          // If direct fetch fails (e.g. CORS restrictions), transparently proxy through the compiler backend
          if (init && init.method && init.method.toUpperCase() !== 'GET' && typeof url === 'string' && url.includes('localhost:' + activePort)) {
            try {
              var headersObj = {};
              if (init.headers) {
                if (typeof init.headers.forEach === 'function') {
                  init.headers.forEach(function(v, k) { headersObj[k] = v; });
                } else {
                  headersObj = init.headers;
                }
              }
              return _nativeFetch('/api/v1/proxy-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url: url,
                  method: init.method,
                  headers: headersObj,
                  body: init.body
                })
              }).then(function(pRes) {
                return pRes.json().then(function(pData) {
                  var resBody = typeof pData.data === 'string' ? pData.data : JSON.stringify(pData.data !== undefined ? pData.data : pData.body || {});
                  return new Response(resBody, {
                    status: pData.status || 200,
                    statusText: 'OK',
                    headers: { 'Content-Type': 'application/json' }
                  });
                });
              });
            } catch(proxyErr) {}
          }
          throw fetchErr;
        });
      };

      // 2. Intercept XMLHttpRequest for relative URLs
      var _origXHR = window.XMLHttpRequest;
      function InterceptedXHR() {
        var xhr = new _origXHR();
        var origOpen = xhr.open;
        xhr.open = function(method, url, async, user, password) {
          var activePort = window.__ACTIVE_SERVER_PORT__ || '3001';
          if (typeof url === 'string') {
            if (!url.startsWith('/api/v1/') && !url.startsWith('/api/v1')) {
              if (url.startsWith('/')) {
                url = 'http://localhost:' + activePort + url;
              } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'http://localhost:' + activePort + '/' + url.replace(/^\.\//, '');
              }
            }
          }
          return origOpen.call(xhr, method, url, async === undefined ? true : async, user, password);
        };
        return xhr;
      }
      window.XMLHttpRequest = InterceptedXHR;

      window.addEventListener('message', function(event) {
        if (!event.data) return;
        if (event.data.type === 'set_active_port') {
          window.__ACTIVE_SERVER_PORT__ = String(event.data.port);
        } else if (event.data.type === 'navigate_to' && event.data.url) {
          window.navigateTo(event.data.url);
        }
      });
      
      document.addEventListener('click', function(e) {
        var anchor = e.target.closest('a');
        if (anchor && anchor.getAttribute('href')) {
          var rawHref = anchor.getAttribute('href');
          var target = anchor.getAttribute('target');
          if (rawHref.startsWith('#')) return;

          var navigated = window.navigateTo(rawHref);
          if (navigated) {
            e.preventDefault();
          } else if (rawHref.startsWith('http') || rawHref.startsWith('/')) {
            if (_top && _top !== window) {
              _top.postMessage({ type: 'preview_navigated', url: rawHref, target: target }, '*');
            }
          }
        }
      });

      // Form Submission & Button Interceptor for interactive preview
      document.addEventListener('submit', async function(e) {
        var form = e.target;
        if (!form) return;
        e.preventDefault();

        var action = form.getAttribute('action') || '';
        var method = (form.getAttribute('method') || 'POST').toUpperCase();
        var formData = new FormData(form);
        var formObj = {};
        formData.forEach(function(val, key) { formObj[key] = val; });

        var activePort = window.__ACTIVE_SERVER_PORT__;

        // 1. If an active server is listening, dispatch request to live server
        if (activePort && (action.startsWith('/') || action.startsWith('http://localhost') || action.startsWith('http://127.0.0.1'))) {
          try {
            var targetUrl = action.startsWith('http') ? action : ('http://localhost:' + activePort + action);
            var params = new URLSearchParams();
            for (var k in formObj) params.append(k, formObj[k]);

            var proxyRes = await fetch('/api/v1/proxy-request', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: targetUrl,
                method: method,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
              }),
            });

            if (proxyRes.ok) {
              var pData = await proxyRes.json();
              // If server responded with 400 empty body because it expects JSON body, retry with JSON
              if (pData && pData.status === 400 && String(pData.data).toLowerCase().includes('empty')) {
                var jsonRetry = await fetch('/api/v1/proxy-request', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    url: targetUrl,
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: formObj,
                  }),
                });
                var jsonPData = await jsonRetry.json();
                if (jsonPData && jsonPData.status !== 400) {
                  pData = jsonPData;
                }
              }

              var bodyContent = pData.data !== undefined ? pData.data : pData.body;
              if (bodyContent !== undefined && bodyContent !== null) {
                var bodyStr = typeof bodyContent === 'string' ? bodyContent : JSON.stringify(bodyContent);
                if (bodyStr.includes('<') && bodyStr.includes('>')) {
                  document.open();
                  document.write(bodyStr);
                  document.close();
                  return;
                }
              }
            }
          } catch (err) {
            console.log('[Preview Form] Live server request error, falling back to virtual page:', err);
          }
        }

        // 2. Virtual Page Fallback (instant UI transition for static preview)
        var candidates = ['/success', 'success', 'success.html', 'sucess.html', 'sucess', 'views/success.html', 'views/sucess.html'];
        for (var pName in window.__VIRTUAL_PAGES__) {
          if (!candidates.includes(pName)) candidates.push(pName);
        }
        var targetKey = null;
        for (var c = 0; c < candidates.length; c++) {
          if (window.__VIRTUAL_PAGES__[candidates[c]]) {
            targetKey = candidates[c];
            break;
          }
        }

        if (targetKey && window.__VIRTUAL_PAGES__[targetKey]) {
          var targetHtml = window.__VIRTUAL_PAGES__[targetKey];
          var taskVal = formObj.taskName || formObj.task || formObj.title || formObj.name || 'New Task';
          targetHtml = targetHtml.replace(/Complete project documentation/g, taskVal);
          targetHtml = targetHtml.replace(/<%=\s*task\s*%>/g, taskVal);
          targetHtml = targetHtml.replace(/<%=\s*lastAddedTask\s*%>/g, taskVal);

          document.open();
          document.write(targetHtml);
          document.close();
        } else {
          console.log('[Preview Form] Form submitted:', formObj);
        }
      });
    })();
  </script>
  ${moduleRegistryScripts}
`;

    if (htmlContent.includes('<head>')) {
      htmlContent = htmlContent.replace('<head>', `<head>${securityArmor}`);
    } else if (htmlContent.includes('<html>')) {
      htmlContent = htmlContent.replace('<html>', `<html><head>${securityArmor}</head>`);
    } else {
      htmlContent = `<head>${securityArmor}</head>${htmlContent}`;
    }

    // Collect standalone CSS and JS
    let aggregatedCss = '';
    let aggregatedJs = '';
    for (const file of resolvedFiles) {
      if (file.path.endsWith('.css')) {
        aggregatedCss += `\n/* ${file.path} */\n` + file.content;
      } else if (file.path.endsWith('.js') && file.path !== entryHtml) {
        aggregatedJs += `\n// ${file.path}\n` + file.content;
      }
    }

    return {
      html: fileMap.get(entryHtml) || htmlContent,
      css: aggregatedCss,
      js: aggregatedJs,
      csp: this.PREVIEW_CSP,
      bundledHtml: htmlContent,
      virtualPages,
    };
  }
}
