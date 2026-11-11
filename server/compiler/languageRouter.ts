/**
 * Language Router & Execution Pipeline Dispatcher
 * Strictly inspects file extensions, project structure, package.json, and metadata
 * to deterministically route files to the appropriate pipeline.
 */

import path from 'path';
import { ProjectFile } from '../../shared/types';

export enum LanguageType {
  JAVASCRIPT = 'JAVASCRIPT',
  COMMONJS = 'COMMONJS',
  ESM = 'ESM',
  TYPESCRIPT = 'TYPESCRIPT',
  TSX = 'TSX',
  JSX = 'JSX',
  JSON = 'JSON',
  HTML = 'HTML',
  CSS = 'CSS',
  EJS = 'EJS',
  UNKNOWN = 'UNKNOWN',
}

export enum PipelineType {
  NODE_DIRECT = 'NODE_DIRECT',                 // .js, .cjs, .mjs (Pure Node.js, zero TS invocation)
  TYPESCRIPT_COMPILE = 'TYPESCRIPT_COMPILE',   // .ts, .tsx (TypeScript transpilation/typecheck -> Node.js)
  JSX_TRANSFORM = 'JSX_TRANSFORM',             // .jsx (JSX transformation -> Node.js / React)
  WEB_PREVIEW = 'WEB_PREVIEW',                 // .html, .css (Browser preview iframe)
  EJS_RENDER = 'EJS_RENDER',                   // .ejs (EJS compilation and preview)
  DATA_ONLY = 'DATA_ONLY',                     // .json
}

export interface PipelineRoute {
  entryLanguage: LanguageType;
  pipeline: PipelineType;
  requiresCompilation: boolean;
  isWebPreview: boolean;
  moduleFormat: 'commonjs' | 'module';
}

/**
 * Detect language of a specific file path
 */
export function detectFileLanguage(filePath: string): LanguageType {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.js':
      return LanguageType.JAVASCRIPT;
    case '.cjs':
      return LanguageType.COMMONJS;
    case '.mjs':
      return LanguageType.ESM;
    case '.ts':
      return LanguageType.TYPESCRIPT;
    case '.tsx':
      return LanguageType.TSX;
    case '.jsx':
      return LanguageType.JSX;
    case '.json':
      return LanguageType.JSON;
    case '.html':
    case '.htm':
      return LanguageType.HTML;
    case '.css':
      return LanguageType.CSS;
    case '.ejs':
      return LanguageType.EJS;
    default:
      return LanguageType.UNKNOWN;
  }
}

/**
 * Determine the project module format based on explicit package.json or entry file content
 */
export function determineModuleFormat(files: ProjectFile[], entryFile?: string): 'commonjs' | 'module' {
  // 1. Explicit package.json defined by user takes highest priority
  const pkgFile = files.find((f) => f.path === 'package.json');
  if (pkgFile) {
    try {
      const parsed = JSON.parse(pkgFile.content);
      if (parsed.type === 'module') return 'module';
      if (parsed.type === 'commonjs') return 'commonjs';
    } catch {
      // ignore invalid package.json
    }
  }

  // 2. Inspect the entry file specifically
  const entry = files.find((f) => f.path === entryFile || f.path === './' + entryFile) ||
    files.find((f) => f.path.endsWith('.js') || f.path.endsWith('.ts') || f.path.endsWith('.mjs'));

  if (entry) {
    if (entry.path.endsWith('.mjs')) return 'module';
    if (entry.path.endsWith('.cjs')) return 'commonjs';

    // If entry uses require() or module.exports, it is CommonJS
    if (entry.content.includes('require(') || entry.content.includes('module.exports') || entry.content.includes('exports.')) {
      return 'commonjs';
    }

    // If entry uses static import / export statement (and no require)
    if (/(^|\n)\s*(import\s+[\s\S]*?from\s+['"]|import\s+['"]|export\s+(default|const|let|var|function|class|\{))/m.test(entry.content)) {
      return 'module';
    }
  }

  // 3. Check any other files in the project
  const hasMjs = files.some((f) => f.path.endsWith('.mjs'));
  if (hasMjs) return 'module';

  // Default Node.js standard behavior is CommonJS
  return 'commonjs';
}

/**
 * Deterministically route a job to its required compilation and runtime pipeline
 */
export function routeExecutionPipeline(files: ProjectFile[], entryFile: string): PipelineRoute {
  const entryLanguage = detectFileLanguage(entryFile);
  const moduleFormat = determineModuleFormat(files, entryFile);

  switch (entryLanguage) {
    case LanguageType.JAVASCRIPT:
    case LanguageType.COMMONJS:
    case LanguageType.ESM: {
      const entryObj = files.find((f) => f.path === entryFile || f.path === './' + entryFile);
      const hasEsModuleSyntax = Boolean(
        entryObj &&
        /(^|\n)\s*(import\s+[\s\S]*?from\s+['"]|import\s+['"]|export\s+(default|const|let|var|function|class|\{))/m.test(entryObj.content)
      );
      const hasExplicitModulePkg = files.some((f) => {
        if (f.path === 'package.json') {
          try {
            return JSON.parse(f.content).type === 'module';
          } catch {
            return false;
          }
        }
        return false;
      });
      const shouldTranspile = Boolean(
        hasEsModuleSyntax && entryLanguage === LanguageType.JAVASCRIPT && !hasExplicitModulePkg
      );
      return {
        entryLanguage,
        pipeline: shouldTranspile ? PipelineType.TYPESCRIPT_COMPILE : PipelineType.NODE_DIRECT,
        requiresCompilation: shouldTranspile,
        isWebPreview: false,
        moduleFormat: shouldTranspile ? 'commonjs' : (entryLanguage === LanguageType.ESM ? 'module' : moduleFormat),
      };
    }

    case LanguageType.TYPESCRIPT:
    case LanguageType.TSX:
      return {
        entryLanguage,
        pipeline: PipelineType.TYPESCRIPT_COMPILE,
        requiresCompilation: true,
        isWebPreview: false,
        moduleFormat,
      };

    case LanguageType.JSX:
      return {
        entryLanguage,
        pipeline: PipelineType.JSX_TRANSFORM,
        requiresCompilation: true,
        isWebPreview: false,
        moduleFormat,
      };

    case LanguageType.HTML:
    case LanguageType.CSS:
      return {
        entryLanguage,
        pipeline: PipelineType.WEB_PREVIEW,
        requiresCompilation: false,
        isWebPreview: true,
        moduleFormat: 'commonjs',
      };

    case LanguageType.EJS:
      return {
        entryLanguage,
        pipeline: PipelineType.EJS_RENDER,
        requiresCompilation: false,
        isWebPreview: true,
        moduleFormat: 'commonjs',
      };

    case LanguageType.JSON:
      return {
        entryLanguage,
        pipeline: PipelineType.DATA_ONLY,
        requiresCompilation: false,
        isWebPreview: false,
        moduleFormat: 'commonjs',
      };

    default:
      return {
        entryLanguage: LanguageType.UNKNOWN,
        pipeline: PipelineType.NODE_DIRECT,
        requiresCompilation: false,
        isWebPreview: false,
        moduleFormat: 'commonjs',
      };
  }
}
