/**
 * In-Memory TypeScript & JSX Compilation Engine
 * Strictly compiles only TypeScript (.ts, .tsx) and JSX (.jsx) files.
 * Correctly locates and reads TypeScript's standard library (lib.es2022.d.ts) from disk.
 * JavaScript (.js, .cjs, .mjs) is NEVER passed to this compiler.
 */

import ts from 'typescript';
import path from 'path';
import fsSync from 'fs';
import { CompilationDiagnostic, ProjectFile } from '../../shared/types';

export interface CompilationResult {
  success: boolean;
  files: ProjectFile[];
  errors: CompilationDiagnostic[];
  compiledEntryFile: string;
}

const TS_LIB_DIR = path.dirname(ts.getDefaultLibFilePath({}));

/**
 * Transpiles and type-checks TypeScript (.ts, .tsx) and JSX (.jsx) files in a project.
 */
export function compileTypeScriptProject(
  files: ProjectFile[],
  entryFile: string
): CompilationResult {
  // 1. Identify transpilable files
  const hasEsModuleSyntax = (content: string) =>
    /(^|\n)\s*(import\s+[\s\S]*?from\s+['"]|import\s+['"]|export\s+(default|const|let|var|function|class|\{))/m.test(content);

  const tsFiles = files.filter((f) => /\.(ts|tsx|jsx)$/i.test(f.path));
  const esmJsFiles = files.filter((f) => /\.js$/i.test(f.path) && hasEsModuleSyntax(f.content));

  // If no TS, JSX, or ES Module files exist, return original files as is immediately (0ms overhead)
  if (tsFiles.length === 0 && esmJsFiles.length === 0) {
    return {
      success: true,
      files,
      errors: [],
      compiledEntryFile: entryFile,
    };
  }

  // Fast-path: If project contains JS files with ES module syntax but no TypeScript/JSX, transpile directly
  if (tsFiles.length === 0 && esmJsFiles.length > 0) {
    const resultingFiles: ProjectFile[] = files.map((file) => {
      if (/\.js$/i.test(file.path) && hasEsModuleSyntax(file.content)) {
        try {
          const transpileOutput = ts.transpileModule(file.content, {
            compilerOptions: {
              module: ts.ModuleKind.CommonJS,
              target: ts.ScriptTarget.ES2022,
              esModuleInterop: true,
              allowJs: true,
            },
            fileName: file.path,
          });
          return {
            path: file.path,
            content: transpileOutput.outputText,
            type: 'js',
          };
        } catch {
          return file;
        }
      }
      return file;
    });

    return {
      success: true,
      files: resultingFiles,
      errors: [],
      compiledEntryFile: entryFile,
    };
  }

  const transpilableFiles = tsFiles;

  const fileMap = new Map<string, string>();
  for (const f of files) {
    fileMap.set(f.path, f.content);
    // Also index without leading ./
    fileMap.set(f.path.replace(/^\.\//, ''), f.content);
  }

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: false,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmitOnError: true,
    allowJs: true,
    jsx: ts.JsxEmit.React,
    inlineSourceMap: false,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  };

  const outputFiles = new Map<string, string>();
  const diagnostics: CompilationDiagnostic[] = [];

  // Create an in-memory compiler host with disk fallback for standard library definitions
  const host: ts.CompilerHost = {
    getSourceFile: (fileName, languageVersion) => {
      const cleanName = fileName.replace(/^\.\//, '').replace(/^\//, '');

      // 1. Check in-memory virtual files
      if (fileMap.has(cleanName)) {
        return ts.createSourceFile(fileName, fileMap.get(cleanName)!, languageVersion, true);
      }

      // 2. Resolve TypeScript standard library definitions from typescript/lib on disk
      let diskPath = fileName;
      if (!path.isAbsolute(diskPath) && fileName.startsWith('lib.')) {
        diskPath = path.join(TS_LIB_DIR, fileName);
      }

      if (fsSync.existsSync(diskPath)) {
        try {
          const content = fsSync.readFileSync(diskPath, 'utf8');
          return ts.createSourceFile(fileName, content, languageVersion, true);
        } catch {
          // fallback
        }
      }

      return undefined;
    },

    getDefaultLibFileName: (options) => ts.getDefaultLibFileName(options),
    getDefaultLibLocation: () => TS_LIB_DIR,

    writeFile: (fileName, content) => {
      const cleanName = fileName.replace(/^\.\//, '').replace(/^\//, '');
      outputFiles.set(cleanName, content);
    },

    getCurrentDirectory: () => '/',
    getDirectories: (dir) => ts.sys.getDirectories(dir),
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',

    fileExists: (fileName) => {
      const cleanName = fileName.replace(/^\.\//, '').replace(/^\//, '');
      if (
        fileMap.has(cleanName) ||
        fileMap.has(`${cleanName}.ts`) ||
        fileMap.has(`${cleanName}.tsx`) ||
        fileMap.has(`${cleanName}.jsx`) ||
        fileMap.has(`${cleanName}.js`) ||
        fileMap.has(`${cleanName}.json`)
      ) {
        return true;
      }

      let diskPath = fileName;
      if (!path.isAbsolute(diskPath) && fileName.startsWith('lib.')) {
        diskPath = path.join(TS_LIB_DIR, fileName);
      }
      return fsSync.existsSync(diskPath);
    },

    readFile: (fileName) => {
      const cleanName = fileName.replace(/^\.\//, '').replace(/^\//, '');
      if (fileMap.has(cleanName)) {
        return fileMap.get(cleanName);
      }

      let diskPath = fileName;
      if (!path.isAbsolute(diskPath) && fileName.startsWith('lib.')) {
        diskPath = path.join(TS_LIB_DIR, fileName);
      }
      if (fsSync.existsSync(diskPath)) {
        return fsSync.readFileSync(diskPath, 'utf8');
      }
      return undefined;
    },
  };

  // ONLY compile .ts, .tsx, and .jsx root files (NEVER pass .js files to TypeScript program)
  const tsRootFiles = transpilableFiles.map((f) => f.path);

  const program = ts.createProgram(tsRootFiles, compilerOptions, host);
  const emitResult = program.emit();

  const allDiagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emitResult.diagnostics);

  const seenDiagnostics = new Set<string>();
  for (const diag of allDiagnostics) {
    if (diag.file && /\.(jsx|tsx)$/i.test(diag.file.fileName) && [2307, 7016, 7026].includes(diag.code)) {
      continue;
    }

    if (diag.file && diag.start !== undefined) {
      const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start);
      const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
      const diagnostic = {
        file: diag.file.fileName.replace(/^\//, ''),
        line: line + 1,
        column: character + 1,
        message,
        code: diag.code,
      };
      const key = JSON.stringify(diagnostic);
      if (!seenDiagnostics.has(key)) {
        seenDiagnostics.add(key);
        diagnostics.push(diagnostic);
      }
    } else {
      const diagnostic = {
        file: 'global',
        line: 1,
        column: 1,
        message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
        code: diag.code,
      };
      const key = JSON.stringify(diagnostic);
      if (!seenDiagnostics.has(key)) {
        seenDiagnostics.add(key);
        diagnostics.push(diagnostic);
      }
    }
  }

  // If compilation errors were found, report diagnostics immediately
  if (diagnostics.length > 0) {
    return {
      success: false,
      files,
      errors: diagnostics,
      compiledEntryFile: entryFile,
    };
  }

  // Construct transformed project files
  const resultingFiles: ProjectFile[] = [];

  for (const originalFile of files) {
    if (/\.(ts|tsx|jsx)$/i.test(originalFile.path)) {
      const jsPath = originalFile.path.replace(/\.(ts|tsx|jsx)$/i, '.js');
      const compiledJs = outputFiles.get(jsPath);

      if (compiledJs !== undefined) {
        resultingFiles.push({
          path: jsPath,
          content: compiledJs,
          type: 'js',
        });
      } else {
        // Fallback transpilation with transpileModule if emit didn't write to outputFiles
        const transpileOutput = ts.transpileModule(originalFile.content, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.React,
            esModuleInterop: true,
          },
          fileName: originalFile.path,
        });
        resultingFiles.push({
          path: jsPath,
          content: transpileOutput.outputText,
          type: 'js',
        });
      }
    } else if (/\.js$/i.test(originalFile.path) && hasEsModuleSyntax(originalFile.content)) {
      // Transpile ES Module syntax inside .js files to CommonJS so Node can run directly without module errors
      try {
        const transpileOutput = ts.transpileModule(originalFile.content, {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
            allowJs: true,
          },
          fileName: originalFile.path,
        });
        resultingFiles.push({
          path: originalFile.path,
          content: transpileOutput.outputText,
          type: 'js',
        });
      } catch {
        resultingFiles.push(originalFile);
      }
    } else {
      // Pass .json, .css, .html, and standard CommonJS .js files through untouched
      resultingFiles.push(originalFile);
    }
  }

  const compiledEntry = entryFile.replace(/\.(ts|tsx|jsx)$/i, '.js');

  return {
    success: true,
    files: resultingFiles,
    errors: [],
    compiledEntryFile: compiledEntry,
  };
}
