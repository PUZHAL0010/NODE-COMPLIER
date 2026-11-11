/**
 * HTML, CSS, and EJS Diagnostic Validator
 * Performs syntactic and structural static analysis for HTML markup,
 * CSS stylesheets, inline scripts/styles, and EJS template tags.
 * Formats errors with exact file, line, column, snippet, and caret pointers.
 */

import { parse } from '@babel/parser';
import { CompilationDiagnostic } from '../../shared/types';

// Void HTML elements that do not require closing tags
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
  '!doctype',
]);

// Standard HTML elements that auto-close when encountering a sibling of the same type or a parent boundary
const AUTO_CLOSE_TAGS = new Set(['li', 'dt', 'dd', 'option', 'tr', 'th', 'td']);

const AUTO_CLOSE_SIBLINGS: Record<string, Set<string>> = {
  li: new Set(['li']),
  dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']),
  option: new Set(['option', 'optgroup']),
  tr: new Set(['tr']),
  th: new Set(['th', 'td']),
  td: new Set(['th', 'td']),
  p: new Set([
    'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl',
    'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2',
    'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'menu', 'nav',
    'ol', 'p', 'pre', 'section', 'table', 'ul'
  ]),
};

interface TagStackItem {
  tag: string;
  line: number;
  column: number;
}

/**
 * Calculate line and column from a character index in a string
 */
function getLineAndCol(text: string, index: number): { line: number; column: number } {
  const prefix = text.slice(0, index);
  const lines = prefix.split(/\r?\n/);
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { line, column };
}

/**
 * Validates HTML code for unclosed/mismatched tags, malformed tags,
 * and syntax errors in embedded <script> and <style> blocks.
 */
export function validateHtmlCode(content: string, fileName = 'index.html', validateEmbeddedEjs = true): CompilationDiagnostic[] {
  const diagnostics: CompilationDiagnostic[] = [];
  if (!content || typeof content !== 'string') return diagnostics;

  const tagStack: TagStackItem[] = [];
  let match: RegExpExecArray | null;

  // 1. Tag parsing regex: matches comments, doctype, tags (<...>)
  const tagRegex = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([a-zA-Z0-9\-_:]+)\s*>|<([a-zA-Z0-9\-_:]+)((?:\s+[^>]*)?)>/gi;

  // We need to skip checking tags inside <script> and <style> blocks
  const scriptStyleRegex = /<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const ignoredIntervals: { start: number; end: number }[] = [];

  // Ignore EJS template scriptlets <% ... %> during HTML tag matching
  const ejsRegex = /<%[\s\S]*?%>/g;
  while ((match = ejsRegex.exec(content)) !== null) {
    ignoredIntervals.push({ start: match.index, end: match.index + match[0].length });
  }

  // Validate EJS scriptlet syntax if present
  if (validateEmbeddedEjs && content.includes('<%')) {
    const ejsDiags = validateEjsCode(content, fileName);
    diagnostics.push(...ejsDiags);
  }

  while ((match = scriptStyleRegex.exec(content)) !== null) {
    const tagName = match[1].toLowerCase();
    const innerContent = match[2];
    const blockStartIndex = match.index;
    const openTagEnd = content.indexOf('>', blockStartIndex) + 1;
    const closeTagStart = blockStartIndex + match[0].lastIndexOf('</');

    ignoredIntervals.push({ start: openTagEnd, end: closeTagStart });

    // Validate JS inside <script>
    if (tagName === 'script') {
      const openTag = content.slice(blockStartIndex, openTagEnd);
      // Only validate JS if not JSON, template, or other non-JS mime types
      const typeMatch = openTag.match(/type\s*=\s*["']([^"']+)["']/i);
      const isJs = !typeMatch || /javascript|ecmascript|module/i.test(typeMatch[1]);

      if (isJs && innerContent.trim().length > 0) {
        try {
          parse(innerContent, {
            sourceType: 'unambiguous',
            plugins: ['jsx'],
            errorRecovery: false,
          });
        } catch (err: any) {
          const innerPos = getLineAndCol(content, openTagEnd);
          const errLine = (innerPos.line - 1) + (err.loc?.line || 1);
          const errCol = err.loc?.line === 1 ? (innerPos.column - 1) + (err.loc?.column || 1) : (err.loc?.column || 1);

          diagnostics.push({
            file: fileName,
            line: errLine,
            column: errCol,
            message: `JavaScript syntax error inside <script>: ${err.message?.replace(/\s*\(\d+:\d+\)$/, '')}`,
            code: 'HTML_JS_SYNTAX_ERROR',
          });
        }
      }
    }

    // Validate CSS inside <style>
    if (tagName === 'style') {
      const cssDiags = validateCssCode(innerContent, fileName, getLineAndCol(content, openTagEnd).line);
      diagnostics.push(...cssDiags);
    }
  }

  // Helper to check if an index is inside an ignored interval
  const isIgnored = (index: number) => {
    return ignoredIntervals.some((int) => index >= int.start && index < int.end);
  };

  // Check for unclosed HTML comments
  const unclosedCommentIndex = content.indexOf('<!--');
  if (unclosedCommentIndex !== -1) {
    const commentClose = content.indexOf('-->', unclosedCommentIndex);
    if (commentClose === -1) {
      const pos = getLineAndCol(content, unclosedCommentIndex);
      diagnostics.push({
        file: fileName,
        line: pos.line,
        column: pos.column,
        message: 'Unclosed HTML comment <!-- without closing -->',
        code: 'HTML_UNCLOSED_COMMENT',
      });
    }
  }

  // Scan for tags
  tagRegex.lastIndex = 0;
  while ((match = tagRegex.exec(content)) !== null) {
    const matchIndex = match.index;
    if (isIgnored(matchIndex)) continue;

    const closingTag = match[1];
    const openingTag = match[2];
    let attrStr = match[3] || '';
    let isSelfClosing = false;
    if (attrStr.trimEnd().endsWith('/')) {
      isSelfClosing = true;
      attrStr = attrStr.trimEnd().slice(0, -1);
    }

    const pos = getLineAndCol(content, matchIndex);

    if (closingTag) {
      const lowerClose = closingTag.toLowerCase();
      if (VOID_ELEMENTS.has(lowerClose)) {
        diagnostics.push({
          file: fileName,
          line: pos.line,
          column: pos.column,
          message: `Void element '<${lowerClose}>' must not have a closing '</${lowerClose}>' tag.`,
          code: 'HTML_VOID_ELEMENT_CLOSED',
        });
        continue;
      }

      // If top element auto-closes when an ancestor closes (e.g. <ul><li>item</ul>)
      while (tagStack.length > 0 && tagStack[tagStack.length - 1].tag.toLowerCase() !== lowerClose) {
        const topOfStack = tagStack[tagStack.length - 1].tag.toLowerCase();
        if (AUTO_CLOSE_TAGS.has(topOfStack)) {
          const isAncestor = tagStack.some((item) => item.tag.toLowerCase() === lowerClose);
          if (isAncestor) {
            tagStack.pop();
            continue;
          }
        }
        break;
      }

      // Pop until we find matching tag or report mismatch
      const top = tagStack[tagStack.length - 1];
      if (!top) {
        diagnostics.push({
          file: fileName,
          line: pos.line,
          column: pos.column,
          message: `Unexpected closing tag '</${closingTag}>' with no matching opening tag.`,
          code: 'HTML_UNEXPECTED_CLOSING_TAG',
        });
      } else if (top.tag.toLowerCase() === lowerClose) {
        tagStack.pop();
      } else {
        // Look ahead in stack to see if an ancestor matches
        const ancestorIndex = tagStack.slice().reverse().findIndex((item) => item.tag.toLowerCase() === lowerClose);
        if (ancestorIndex !== -1) {
          const actualIndex = tagStack.length - 1 - ancestorIndex;
          const unclosed = tagStack[tagStack.length - 1];
          diagnostics.push({
            file: fileName,
            line: pos.line,
            column: pos.column,
            message: `Mismatched closing tag '</${closingTag}>'. Expected closing tag '</${unclosed.tag}>' for element opened at line ${unclosed.line}:${unclosed.column}.`,
            code: 'HTML_MISMATCHED_TAG',
          });
          tagStack.splice(actualIndex);
        } else {
          diagnostics.push({
            file: fileName,
            line: pos.line,
            column: pos.column,
            message: `Unexpected closing tag '</${closingTag}>' does not match opened tag '<${top.tag}>' at line ${top.line}:${top.column}.`,
            code: 'HTML_UNEXPECTED_CLOSING_TAG',
          });
        }
      }
    } else if (openingTag) {
      const lowerOpen = openingTag.toLowerCase();

      // Check if previous sibling auto-closes (e.g. <li> before another <li>, <p> before block element)
      if (tagStack.length > 0) {
        const topTag = tagStack[tagStack.length - 1].tag.toLowerCase();
        if (AUTO_CLOSE_SIBLINGS[topTag]?.has(lowerOpen)) {
          tagStack.pop();
        }
      }

      // Check for unclosed attribute quote inside opening tag
      if (attrStr) {
        let inQuote: string | null = null;
        let quoteIdx = 0;
        for (let i = 0; i < attrStr.length; i++) {
          const ch = attrStr[i];
          if (inQuote) {
            if (ch === inQuote) {
              inQuote = null;
            }
          } else if (ch === '"' || ch === "'") {
            inQuote = ch;
            quoteIdx = i;
          }
        }
        if (inQuote) {
          diagnostics.push({
            file: fileName,
            line: pos.line,
            column: pos.column + quoteIdx + 1,
            message: `Unclosed attribute quote (${inQuote}) in tag '<${openingTag}>'. Missing matching closing quote before '>'.`,
            code: 'HTML_UNCLOSED_ATTRIBUTE_QUOTE',
          });
        }
      }

      if (!VOID_ELEMENTS.has(lowerOpen) && !isSelfClosing) {
        tagStack.push({
          tag: openingTag,
          line: pos.line,
          column: pos.column,
        });
      }
    }
  }

  // Report any remaining unclosed tags
  while (tagStack.length > 0) {
    const unclosed = tagStack.pop()!;
    // Standard lenient root/auto-closing elements don't trigger fatal error at EOF
    if (!['html', 'body', 'head', 'p', 'li', 'dt', 'dd', 'option'].includes(unclosed.tag.toLowerCase())) {
      diagnostics.push({
        file: fileName,
        line: unclosed.line,
        column: unclosed.column,
        message: `Unclosed tag '<${unclosed.tag}>' opened at line ${unclosed.line} does not have a matching closing '</${unclosed.tag}>' tag.`,
        code: 'HTML_UNCLOSED_TAG',
      });
    }
  }

  return diagnostics;
}

/**
 * Validates standalone or inline CSS syntax for unclosed braces, comments, strings, parentheses, etc.
 */
export function validateCssCode(content: string, fileName = 'styles.css', lineOffset = 1): CompilationDiagnostic[] {
  const diagnostics: CompilationDiagnostic[] = [];
  if (!content || typeof content !== 'string') return diagnostics;

  let inComment = false;
  let inString: string | null = null;
  let stringStartLine = 1;
  let stringStartCol = 1;
  let commentStartLine = 1;
  let commentStartCol = 1;
  const braceStack: { line: number; column: number }[] = [];
  const parenStack: { line: number; column: number }[] = [];

  const lines = content.split(/\r?\n/);
  for (let l = 0; l < lines.length; l++) {
    const currentLine = lines[l];
    const actualLine = lineOffset + l;

    for (let c = 0; c < currentLine.length; c++) {
      const char = currentLine[c];
      const nextChar = currentLine[c + 1];

      // Comment start /*
      if (!inComment && !inString && char === '/' && nextChar === '*') {
        inComment = true;
        commentStartLine = actualLine;
        commentStartCol = c + 1;
        c++;
        continue;
      }

      // Comment end */
      if (inComment && char === '*' && nextChar === '/') {
        inComment = false;
        c++;
        continue;
      }

      if (inComment) continue;

      // Handle escaped characters inside strings: \" or \'
      if (inString && char === '\\') {
        c++;
        continue;
      }

      // String toggle: " or '
      if (!inString && (char === '"' || char === "'")) {
        inString = char;
        stringStartLine = actualLine;
        stringStartCol = c + 1;
        continue;
      } else if (inString && char === inString) {
        inString = null;
        continue;
      }

      if (inString) continue;

      // Parentheses for calc(), var(), url(), @media ()
      if (char === '(') {
        parenStack.push({ line: actualLine, column: c + 1 });
      } else if (char === ')') {
        if (parenStack.length === 0) {
          diagnostics.push({
            file: fileName,
            line: actualLine,
            column: c + 1,
            message: "Unexpected closing parenthesis ')' with no matching opening '('.",
            code: 'CSS_UNEXPECTED_CLOSING_PAREN',
          });
        } else {
          parenStack.pop();
        }
      }

      // Braces { and }
      if (char === '{') {
        braceStack.push({ line: actualLine, column: c + 1 });
      } else if (char === '}') {
        if (braceStack.length === 0) {
          diagnostics.push({
            file: fileName,
            line: actualLine,
            column: c + 1,
            message: "Unexpected closing brace '}' without matching opening declaration '{'.",
            code: 'CSS_UNEXPECTED_CLOSING_BRACE',
          });
        } else {
          braceStack.pop();
        }
      }
    }

    // Unclosed string on single line (in CSS, strings cannot span lines without trailing backslash)
    if (inString && !currentLine.endsWith('\\')) {
      diagnostics.push({
        file: fileName,
        line: stringStartLine,
        column: stringStartCol,
        message: `Unclosed string literal (${inString}) in CSS declaration.`,
        code: 'CSS_UNCLOSED_STRING',
      });
      inString = null;
    }
  }

  if (inComment) {
    diagnostics.push({
      file: fileName,
      line: commentStartLine,
      column: commentStartCol,
      message: 'Unclosed CSS comment /* without matching */.',
      code: 'CSS_UNCLOSED_COMMENT',
    });
  }

  for (const unclosedParen of parenStack) {
    diagnostics.push({
      file: fileName,
      line: unclosedParen.line,
      column: unclosedParen.column,
      message: "Unclosed parenthesis '(' in CSS declaration.",
      code: 'CSS_UNCLOSED_PARENTHESIS',
    });
  }

  for (const unclosed of braceStack) {
    diagnostics.push({
      file: fileName,
      line: unclosed.line,
      column: unclosed.column,
      message: "Unclosed CSS block '{' does not have a matching closing '}'.",
      code: 'CSS_UNCLOSED_BLOCK',
    });
  }

  return diagnostics;
}

/**
 * Validates EJS template files for unclosed delimiters and scriptlet syntax
 */
export function validateEjsCode(content: string, fileName = 'index.ejs'): CompilationDiagnostic[] {
  const diagnostics: CompilationDiagnostic[] = [];
  if (!content || typeof content !== 'string') return diagnostics;

  const lines = content.split(/\r?\n/);
  const delimiterRegex = /<%([=\-_#]?)([\s\S]*?)%>|<%([=\-_#]?)/g;

  let match: RegExpExecArray | null;
  while ((match = delimiterRegex.exec(content)) !== null) {
    const fullMatch = match[0];
    const matchIndex = match.index;
    const pos = getLineAndCol(content, matchIndex);

    // Unclosed delimiter <% without %>
    if (!fullMatch.endsWith('%>')) {
      diagnostics.push({
        file: fileName,
        line: pos.line,
        column: pos.column,
        message: "Unclosed EJS delimiter '<%' without matching '%>'.",
        code: 'EJS_UNCLOSED_DELIMITER',
      });
      continue;
    }

    const modifier = match[1];
    const jsCode = match[2];

    // Check scriptlet JS syntax (skip comments)
    if (modifier !== '#' && jsCode.trim().length > 0) {
      const isExpression = modifier === '=' || modifier === '-';
      const cleanJs = jsCode.trim();

      // Don't validate control flow fragments like '} else {' or '})'
      if (!isExpression && /^[\s\}\)\]]+$/.test(cleanJs)) {
        continue;
      }

      try {
        const testCode = isExpression ? `(${cleanJs})` : `function __ejs_test__() { ${cleanJs} }`;
        parse(testCode, {
          sourceType: 'unambiguous',
          errorRecovery: false,
        });
      } catch (err: any) {
        // If it's an unclosed control block like `if (true) {` or `items.forEach(item => {`, that is normal in EJS templates!
        const msg = err.message || '';
        const isControlFragment = msg.includes('Unexpected token') && (cleanJs.endsWith('{') || cleanJs.startsWith('}'));
        if (!isControlFragment) {
          diagnostics.push({
            file: fileName,
            line: pos.line,
            column: pos.column + 2,
            message: `Syntax error inside EJS scriptlet: ${msg.replace(/\s*\(\d+:\d+\)$/, '')}`,
            code: 'EJS_SYNTAX_ERROR',
          });
        }
      }
    }
  }

  // Also validate HTML markup outside EJS scriptlets
  const htmlWithoutEjs = content.replace(/<%[\s\S]*?(%>|$)/g, ' ');
  const htmlDiags = validateHtmlCode(htmlWithoutEjs, fileName, false);
  diagnostics.push(...htmlDiags);

  return diagnostics;
}

/**
 * Format a diagnostic with exact line, column, snippet, and caret pointer
 */
export function formatDiagnostic(diag: CompilationDiagnostic, fileContent: string): string {
  const lines = (fileContent || '').split(/\r?\n/);
  const lineNum = diag.line || 1;
  const colNum = Math.max(1, diag.column || 1);
  const lineContent = lines[lineNum - 1] || '';
  const caretPad = ' '.repeat(Math.max(0, colNum - 1));

  return (
    `/workspace/${diag.file}:${lineNum}:${colNum} - error ${diag.code || 'COMPILER'}: ${diag.message}\n\n` +
    `${lineNum} ${lineContent}\n  ${caretPad}^\n`
  );
}
