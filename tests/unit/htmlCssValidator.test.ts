import {
  validateHtmlCode,
  validateCssCode,
  validateEjsCode,
  formatDiagnostic,
} from '../../server/validation/htmlCssValidator';

describe('HTML, CSS, and EJS Diagnostic Validator', () => {
  describe('HTML Validation', () => {
    it('accepts valid HTML5 documents without diagnostics', () => {
      const validHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Valid Document</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="root">
    <h1>Hello World</h1>
    <img src="logo.png" alt="Logo">
    <input type="text" placeholder="Name">
    <br>
  </div>
</body>
</html>`;
      const diagnostics = validateHtmlCode(validHtml, 'index.html');
      expect(diagnostics).toHaveLength(0);
    });

    it('detects unclosed tags', () => {
      const brokenHtml = `<!DOCTYPE html>
<html>
<body>
  <div>
    <p>This paragraph is unclosed!
  </div>
</body>
</html>`;
      const diagnostics = validateHtmlCode(brokenHtml, 'index.html');
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some((d) => d.code === 'HTML_MISMATCHED_TAG' || d.code === 'HTML_UNCLOSED_TAG')).toBe(true);
    });

    it('detects mismatched closing tags', () => {
      const mismatchedHtml = `<div><span>Mismatched tag</div></span>`;
      const diagnostics = validateHtmlCode(mismatchedHtml, 'test.html');
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some((d) => d.code === 'HTML_MISMATCHED_TAG')).toBe(true);
    });

    it('detects closed void elements', () => {
      const badVoidHtml = `<p>Test <br></br> image <img src="x.jpg"></img></p>`;
      const diagnostics = validateHtmlCode(badVoidHtml, 'test.html');
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some((d) => d.code === 'HTML_VOID_ELEMENT_CLOSED')).toBe(true);
    });

    it('detects JavaScript syntax errors inside inline <script> tags', () => {
      const badScriptHtml = `<!DOCTYPE html>
<html>
<head>
  <script>
    const x = ; // Syntax error here!
  </script>
</head>
<body></body>
</html>`;
      const diagnostics = validateHtmlCode(badScriptHtml, 'index.html');
      expect(diagnostics.length).toBeGreaterThan(0);
      const scriptDiag = diagnostics.find((d) => d.code === 'HTML_JS_SYNTAX_ERROR');
      expect(scriptDiag).toBeDefined();
      expect(scriptDiag?.line).toBe(5);
    });

    it('detects CSS syntax errors inside inline <style> tags', () => {
      const badStyleHtml = `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      color: red;
      /* unclosed brace
  </style>
</head>
<body></body>
</html>`;
      const diagnostics = validateHtmlCode(badStyleHtml, 'index.html');
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some((d) => d.code === 'CSS_UNCLOSED_BLOCK')).toBe(true);
    });
    it('accepts full spectrum of HTML5 semantic elements, forms, tables, media, and canvas', () => {
      const advancedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Comprehensive HTML5 Showcase</title>
</head>
<body>
  <header>
    <nav>
      <a href="#home">Home</a>
    </nav>
  </header>
  <main>
    <section>
      <article>
        <h1>Semantic Article</h1>
        <p>Paragraph with <strong>bold</strong>, <em>italic</em>, <mark>highlight</mark>, and <code>code</code>.</p>
        <details>
          <summary>More Info</summary>
          <p>Hidden content revealed on click.</p>
        </details>
      </article>
      <form action="/submit" method="POST">
        <fieldset>
          <legend>User Information</legend>
          <label for="username">Username:</label>
          <input type="text" id="username" name="username" required>
          <label for="bio">Bio:</label>
          <textarea id="bio" name="bio" rows="4"></textarea>
          <label for="country">Country:</label>
          <select id="country" name="country">
            <option value="us">United States</option>
            <option value="ca">Canada</option>
          </select>
          <button type="submit">Submit</button>
        </fieldset>
      </form>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td>
            <td>Alpha</td>
          </tr>
        </tbody>
      </table>
      <canvas id="myCanvas" width="200" height="100"></canvas>
      <svg width="100" height="100">
        <circle cx="50" cy="50" r="40" stroke="green" stroke-width="4" fill="yellow" />
      </svg>
      <audio controls src="audio.mp3"></audio>
      <video controls width="250">
        <source src="flower.webm" type="video/webm">
      </video>
    </section>
  </main>
  <footer>
    <p>&copy; 2026 Node Platform</p>
  </footer>
</body>
</html>`;
      const diagnostics = validateHtmlCode(advancedHtml, 'showcase.html');
      expect(diagnostics).toHaveLength(0);
    });

    it('accepts valid HTML auto-closing tags for list items and select options', () => {
      const autoClosingHtml = `<!DOCTYPE html>
<html>
<body>
  <ul>
    <li>Item 1
    <li>Item 2
    <li>Item 3
  </ul>
  <select>
    <option value="1">Option 1
    <option value="2">Option 2
  </select>
  <dl>
    <dt>Term 1
    <dd>Definition 1
    <dt>Term 2
    <dd>Definition 2
  </dl>
</body>
</html>`;
      const diagnostics = validateHtmlCode(autoClosingHtml, 'auto_close.html');
      expect(diagnostics).toHaveLength(0);
    });

    it('detects unclosed attribute quotes in HTML elements', () => {
      const unclosedQuoteHtml = `<!DOCTYPE html>
<html>
<body>
  <div class="card id="container">
    <p>Test</p>
  </div>
</body>
</html>`;
      const diagnostics = validateHtmlCode(unclosedQuoteHtml, 'broken_quote.html');
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some((d) => d.code === 'HTML_UNCLOSED_ATTRIBUTE_QUOTE')).toBe(true);
    });
  });

  describe('CSS Validation', () => {
    it('accepts clean CSS styles with variables, keyframes, media queries, and pseudo-elements', () => {
      const validCss = `
        :root {
          --primary-color: #3b82f6;
          --bg-card: hsl(220, 13%, 18%);
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 768px) {
          .card { width: 100%; }
        }
        body { margin: 0; padding: 20px; font-family: sans-serif; background: var(--bg-card); }
        .card { background: #1e293b; color: #fff; border-radius: 8px; animation: fadeIn 0.3s ease; }
        .card::before { content: ""; display: block; }
        input[type="text"]:focus { outline: 2px solid var(--primary-color); }
      `;
      const diagnostics = validateCssCode(validCss, 'styles.css');
      expect(diagnostics).toHaveLength(0);
    });

    it('accepts CSS strings containing curly braces without false syntax errors', () => {
      const stringBraceCss = `
        .badge::after {
          content: " { status: active } ";
          display: inline-block;
        }
        .icon-close::before {
          content: "}";
        }
      `;
      const diagnostics = validateCssCode(stringBraceCss, 'styles.css');
      expect(diagnostics).toHaveLength(0);
    });

    it('detects unclosed string literals in CSS', () => {
      const unclosedStringCss = `
        .title::after {
          content: "unclosed string without end quote;
          color: red;
        }
      `;
      const diagnostics = validateCssCode(unclosedStringCss, 'styles.css');
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some((d) => d.code === 'CSS_UNCLOSED_STRING')).toBe(true);
    });

    it('detects unclosed parentheses in CSS functions (calc, var, rgb)', () => {
      const unclosedParenCss = `
        .container {
          width: calc(100% - 40px;
          color: rgb(255, 0, 0);
        }
      `;
      const diagnostics = validateCssCode(unclosedParenCss, 'styles.css');
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some((d) => d.code === 'CSS_UNCLOSED_PARENTHESIS')).toBe(true);
    });

    it('detects unclosed curly braces in CSS', () => {
      const unclosedCss = `
        body {
          margin: 0;
        
        .container {
          padding: 10px;
        }
      `;
      const diagnostics = validateCssCode(unclosedCss, 'styles.css');
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some((d) => d.code === 'CSS_UNCLOSED_BLOCK')).toBe(true);
    });

    it('detects unexpected closing braces in CSS', () => {
      const extraBraceCss = `
        body { margin: 0; }
        }
      `;
      const diagnostics = validateCssCode(extraBraceCss, 'styles.css');
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some((d) => d.code === 'CSS_UNEXPECTED_CLOSING_BRACE')).toBe(true);
    });

    it('detects unclosed comments in CSS', () => {
      const unclosedCommentCss = `
        /* Unclosed comment
        body { margin: 0; }
      `;
      const diagnostics = validateCssCode(unclosedCommentCss, 'styles.css');
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some((d) => d.code === 'CSS_UNCLOSED_COMMENT')).toBe(true);
    });
  });

  describe('EJS Validation', () => {
    it('accepts valid EJS templates', () => {
      const validEjs = `
        <div>
          <h2><%= title %></h2>
          <ul>
            <% items.forEach(function(item) { %>
              <li><%= item %></li>
            <% }); %>
          </ul>
        </div>
      `;
      const diagnostics = validateEjsCode(validEjs, 'index.ejs');
      expect(diagnostics).toHaveLength(0);
    });

    it('detects unclosed EJS delimiters', () => {
      const unclosedEjs = `
        <div>
          <h2><%= title</h2>
        </div>
      `;
      const diagnostics = validateEjsCode(unclosedEjs, 'index.ejs');
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some((d) => d.code === 'EJS_UNCLOSED_DELIMITER')).toBe(true);
    });

    it('detects syntax errors inside EJS expressions', () => {
      const brokenExprEjs = `
        <div>
          <h2><%= const x = ; %></h2>
        </div>
      `;
      const diagnostics = validateEjsCode(brokenExprEjs, 'index.ejs');
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some((d) => d.code === 'EJS_SYNTAX_ERROR')).toBe(true);
    });
  });

  describe('Diagnostic Formatting', () => {
    it('formats compiler diagnostics with line number, snippet, and caret pointer', () => {
      const content = `<!DOCTYPE html>\n<html>\n  <div\n</html>`;
      const diag = {
        file: 'index.html',
        line: 3,
        column: 3,
        message: "Unclosed tag '<div>'",
        code: 'HTML001',
      };
      const formatted = formatDiagnostic(diag, content);
      expect(formatted).toContain('/workspace/index.html:3:3 - error HTML001: Unclosed tag');
      expect(formatted).toContain('3   <div');
      expect(formatted).toContain('^');
    });
  });
});
