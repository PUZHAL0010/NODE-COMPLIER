/**
 * Universal Node.js Code Editor & API Testing Platform
 * Left: Monaco Code Editor • Right: Terminal, API Testing & HTML Preview
 */

const EXPRESS_API_STARTER = `// Production-Ready Express REST API Server
// Click "Run" (Ctrl+Enter) and test these endpoints in the "API Testing" tab (Thunder Client)!

const express = require('express');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

// In-memory data store
let items = [
  { id: 1, title: 'Learn Node.js Compiler', status: 'completed' },
  { id: 2, title: 'Build Secure API Endpoints', status: 'in-progress' },
  { id: 3, title: 'Test with Thunder Client', status: 'pending' },
];

// 1. Health & Server Info
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    platform: 'Node.js Sandbox',
    endpoints: [
      'GET  /api/items',
      'POST /api/items',
      'GET  /api/items/:id',
      'GET  /api/system'
    ],
    timestamp: new Date().toISOString()
  });
});

// 2. GET all items
app.get('/api/items', (req, res) => {
  res.json({ success: true, count: items.length, items });
});

// 3. POST new item
app.post('/api/items', (req, res) => {
  const { title, status } = req.body || {};
  if (!title) {
    return res.status(400).json({ success: false, error: 'Title field is required' });
  }
  const newItem = {
    id: items.length + 1,
    title,
    status: status || 'pending'
  };
  items.push(newItem);
  res.status(201).json({ success: true, item: newItem });
});

// 4. GET item by ID
app.get('/api/items/:id', (req, res) => {
  const item = items.find(i => i.id === parseInt(req.params.id, 10));
  if (!item) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }
  res.json({ success: true, item });
});

// 5. System telemetry endpoint
app.get('/api/system', (req, res) => {
  res.json({
    uptimeSec: Math.round(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    nodeVersion: process.version
  });
});

app.listen(PORT, () => {
  console.log(\`🚀 Express server online and listening at http://localhost:\${PORT}\`);
  console.log(\`⚡ Open the "API Testing" tab on the right to test your live endpoints!\`);
});
`;

const HTTP_SERVER_STARTER = `// Native Node.js HTTP Server (Zero External Dependencies)
// Click "Run" (Ctrl+Enter) and test endpoints in Thunder Client!

const http = require('http');

const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200);
    return res.end(JSON.stringify({
      message: 'Hello from Native Node.js HTTP Server!',
      availableRoutes: ['GET /', 'GET /api/status', 'POST /api/echo']
    }));
  }

  if (req.url === '/api/status' && req.method === 'GET') {
    res.writeHead(200);
    return res.end(JSON.stringify({
      status: 'healthy',
      uptime: process.uptime(),
      memory: process.memoryUsage().heapUsed
    }));
  }

  if (req.url === '/api/echo' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        receivedBody: body ? JSON.parse(body) : null
      }));
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Route not found' }));
});

server.listen(PORT, () => {
  console.log(\`🚀 HTTP Server listening on port \${PORT}\`);
});
`;

const BASIC_SCRIPT_STARTER = `// Universal Node.js Script
const os = require('os');

console.log("=== Execution Started ===");
console.log("Platform:", os.platform(), os.arch());
console.log("Node Version:", process.version);
console.log("Memory:", Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + " MB");

async function runDemo() {
  const message = await Promise.resolve("Hello from Node.js Sandbox!");
  console.log("Async Output:", message);
  console.log("=== Execution Complete ===");
}

runDemo();
`;

const DEFAULT_STARTER_CODE = EXPRESS_API_STARTER;

class CodeEditorApp {
  constructor() {
    this.files = new Map();
    this.entryFile = 'index.js';
    this.activeFilePath = 'index.js';
    this.openTabs = ['index.js'];
    this.editor = null;
    this.fallbackTextarea = null;
    this.activeJobId = null;
    this.activeEventSource = null;
    this.isExecuting = false;
    this.isExplorerOpen = false;
    this.activeServerPort = null;
    this.fontSize = parseInt(localStorage.getItem('code_editor_font_size') || localStorage.getItem('vscode_compiler_font_size') || '14', 10);
    this.alertAutoDismissTimer = null;
    this.browserTabs = [];
    this.activeBrowserTabId = null;
    this.browserDeviceWidth = '100%';

    this.initFiles();
    this.initElements();
    this.renderTabs();
    this.renderExplorerTree();
    this.initEvents();
    this.initThunderClient();
    this.initChromeBrowser();
    this.initMonaco();
    this.applyFontSize(this.fontSize);
  }

  initFiles() {
    try {
      const saved = localStorage.getItem('node_compiler_files');
      const savedActive = localStorage.getItem('node_compiler_active_file');
      const savedTabs = localStorage.getItem('node_compiler_open_tabs');

      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          for (const f of parsed) {
            this.files.set(f.path, {
              path: f.path,
              content: f.content,
              type: this.detectFileType(f.path),
            });
          }
          if (savedTabs) {
            const parsedTabs = JSON.parse(savedTabs);
            if (Array.isArray(parsedTabs) && parsedTabs.length > 0) {
              this.openTabs = parsedTabs.filter((p) => this.files.has(p));
            }
          }
          if (savedActive && this.files.has(savedActive)) {
            this.activeFilePath = savedActive;
            this.entryFile = savedActive;
          } else {
            this.activeFilePath = parsed[0].path;
            this.entryFile = parsed[0].path;
          }
          if (!this.openTabs || this.openTabs.length === 0) {
            this.openTabs = [this.activeFilePath || parsed[0].path];
          }
          return;
        }
      }
    } catch (e) {
      console.warn('Could not load saved files', e);
    }

    this.files.set('index.js', {
      path: 'index.js',
      content: DEFAULT_STARTER_CODE,
      type: 'js',
    });
    this.openTabs = ['index.js'];
    this.activeFilePath = 'index.js';
    this.entryFile = 'index.js';
  }

  saveFiles() {
    try {
      const fileList = Array.from(this.files.values()).map((f) => ({
        path: f.path,
        content: f.content,
      }));
      localStorage.setItem('node_compiler_files', JSON.stringify(fileList));
      localStorage.setItem('node_compiler_active_file', this.activeFilePath);
      localStorage.setItem('node_compiler_open_tabs', JSON.stringify(this.openTabs));
    } catch (e) {
      console.warn('Could not save files', e);
    }
  }

  initElements() {
    this.el = {
      statusBadge: document.getElementById('executionStatusBadge'),
      statusBadgeText: document.getElementById('statusBadgeText'),
      durationBadge: document.getElementById('durationBadge'),
      durationValue: document.getElementById('durationValue'),
      btnRun: document.getElementById('btnRun'),
      btnStop: document.getElementById('btnStop'),
      btnNewFileHeader: document.getElementById('btnNewFileHeader'),
      btnNewTab: document.getElementById('btnNewTab'),
      btnToggleExplorer: document.getElementById('btnToggleExplorer'),
      btnOpenThunderSide: document.getElementById('btnOpenThunderSide'),
      fileExplorerDrawer: document.getElementById('fileExplorerDrawer'),
      btnNewFileSidebar: document.getElementById('btnNewFileSidebar'),
      btnClearStorage: document.getElementById('btnClearStorage'),
      fileTreeContainer: document.getElementById('fileTreeContainer'),
      tabsBar: document.getElementById('tabsBar'),
      monacoContainer: document.getElementById('monacoContainer'),
      editorCursorPos: document.getElementById('editorCursorPosition'),
      // Font size elements
      btnFontDec: document.getElementById('btnFontDec'),
      btnFontInc: document.getElementById('btnFontInc'),
      fontSizeSelect: document.getElementById('fontSizeSelect'),
      currentFontSizeBadge: document.getElementById('currentFontSizeBadge'),
      // Splitter
      mainVerticalSplitter: document.getElementById('mainVerticalSplitter'),
      editorPane: document.getElementById('editorPane'),
      outputPane: document.getElementById('outputPane'),
      // Workbench Output Panels
      consoleOutput: document.getElementById('consoleOutput'),
      consolePlaceholder: document.getElementById('consolePlaceholder'),
      btnClearConsole: document.getElementById('btnClearConsole'),
      previewIframe: document.getElementById('previewIframe'),
      btnRefreshPreview: document.getElementById('btnRefreshPreview'),
      btnInjectInnerHtml: document.getElementById('btnInjectInnerHtml'),
      // Chrome Browser Controls
      chromeTabsList: document.getElementById('chromeTabsList'),
      btnChromeNewTab: document.getElementById('btnChromeNewTab'),
      btnBrowserBack: document.getElementById('btnBrowserBack'),
      btnBrowserForward: document.getElementById('btnBrowserForward'),
      btnBrowserHome: document.getElementById('btnBrowserHome'),
      browserUrlInput: document.getElementById('browserUrlInput'),
      btnBrowserGo: document.getElementById('btnBrowserGo'),
      btnViewDesktop: document.getElementById('btnViewDesktop'),
      btnViewTablet: document.getElementById('btnViewTablet'),
      btnViewMobile: document.getElementById('btnViewMobile'),
      btnBrowserPopout: document.getElementById('btnBrowserPopout'),
      chromeViewportHost: document.getElementById('chromeViewportHost'),
      // Thunder Client
      thunderMethod: document.getElementById('thunderMethod'),
      thunderUrl: document.getElementById('thunderUrl'),
      btnThunderSend: document.getElementById('btnThunderSend'),
      thunderSendText: document.getElementById('thunderSendText'),
      thunderParamsList: document.getElementById('thunderParamsList'),
      btnAddParamRow: document.getElementById('btnAddParamRow'),
      thunderHeadersList: document.getElementById('thunderHeadersList'),
      btnAddHeaderRow: document.getElementById('btnAddHeaderRow'),
      thunderBodyText: document.getElementById('thunderBodyText'),
      btnFormatJson: document.getElementById('btnFormatJson'),
      respStatusBadge: document.getElementById('respStatusBadge'),
      respTime: document.getElementById('respTime'),
      respSize: document.getElementById('respSize'),
      respBodyPre: document.getElementById('respBodyPre'),
      respHeadersPre: document.getElementById('respHeadersPre'),
      respRawPre: document.getElementById('respRawPre'),
      thunderPreviewIframe: document.getElementById('thunderPreviewIframe'),
      // System Alert Elements
      systemAlertBanner: document.getElementById('systemAlertBanner'),
      alertBannerIcon: document.getElementById('alertBannerIcon'),
      alertBannerText: document.getElementById('alertBannerText'),
      alertBannerClose: document.getElementById('alertBannerClose'),
      // Modal
      modalOverlay: document.getElementById('modalOverlay'),
      modalTitle: document.getElementById('modalTitle'),
      modalInput: document.getElementById('modalInput'),
      modalError: document.getElementById('modalError'),
      btnModalCancel: document.getElementById('btnModalCancel'),
      btnModalConfirm: document.getElementById('btnModalConfirm'),
    };
  }

  setupFallbackEditor() {
    if (this.editor || this.fallbackTextarea || !this.el.monacoContainer) return;
    const currentFile = this.files.get(this.activeFilePath);
    this.fallbackTextarea = document.createElement('textarea');
    this.fallbackTextarea.className = 'fallback-code-editor';
    this.fallbackTextarea.value = currentFile ? currentFile.content : '';
    this.fallbackTextarea.spellcheck = false;
    this.fallbackTextarea.placeholder = '// Write your Node.js or Web code here...';
    this.fallbackTextarea.oninput = () => {
      const activeObj = this.files.get(this.activeFilePath);
      if (activeObj) {
        activeObj.content = this.fallbackTextarea.value;
        this.saveFiles();
      }
    };
    this.el.monacoContainer.innerHTML = '';
    this.el.monacoContainer.appendChild(this.fallbackTextarea);
  }

  initMonaco() {
    this.setupFallbackEditor();

    if (window.require) {
      window.require.config({
        paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.46.0/min/vs' },
      });

      window.require(['vs/editor/editor.main'], () => {
        if (this.fallbackTextarea && this.fallbackTextarea.parentNode) {
          this.fallbackTextarea.parentNode.removeChild(this.fallbackTextarea);
          this.fallbackTextarea = null;
        }

        this.editor = monaco.editor.create(this.el.monacoContainer, {
          value: this.files.get(this.activeFilePath)?.content || '',
          language: this.getMonacoLanguage(this.activeFilePath),
          theme: 'vs-dark',
          automaticLayout: true,
          fontFamily: "'Fira Code', 'Cascadia Code', Consolas, Monaco, monospace",
          fontSize: this.fontSize,
          lineHeight: Math.round(this.fontSize * 1.55),
          tabSize: 2,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          bracketPairColorization: { enabled: true },
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
        });

        this.editor.onDidChangeModelContent(() => {
          const currentContent = this.editor.getValue();
          const fileObj = this.files.get(this.activeFilePath);
          if (fileObj) {
            fileObj.content = currentContent;
            this.saveFiles();
          }
        });

        this.editor.onDidChangeCursorPosition((e) => {
          if (this.el.editorCursorPos) {
            this.el.editorCursorPos.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
          }
        });

        this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
          this.executeCode();
        });

        this.renderTabs();
        this.renderExplorerTree();

        // Bind System Alert Banner Close
        if (this.el.alertBannerClose && this.el.systemAlertBanner) {
          this.el.alertBannerClose.addEventListener('click', () => {
            this.dismissSystemAlert();
          });
        }
        this.listenToSystemAlerts();
      });
    }
  }

  // --- Font Size Adjustment System ---
  applyFontSize(size) {
    const clamped = Math.min(Math.max(size, 10), 28);
    this.fontSize = clamped;
    localStorage.setItem('code_editor_font_size', String(clamped));
    document.documentElement.style.setProperty('--user-code-font-size', `${clamped}px`);

    if (this.editor) {
      this.editor.updateOptions({
        fontSize: clamped,
        lineHeight: Math.round(clamped * 1.55),
      });
    }

    if (this.el.consoleOutput) {
      this.el.consoleOutput.style.fontSize = `${clamped}px`;
    }

    if (this.el.fontSizeSelect) {
      this.el.fontSizeSelect.value = String(clamped);
    }
    if (this.el.currentFontSizeBadge) {
      this.el.currentFontSizeBadge.textContent = `${clamped}px`;
    }
  }

  detectFileType(filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts': return 'typescript';
      case 'tsx': return 'typescript';
      case 'jsx': return 'javascript';
      case 'js':
      case 'mjs':
      case 'cjs': return 'javascript';
      case 'html': return 'html';
      case 'ejs': return 'html';
      case 'css': return 'css';
      case 'json': return 'json';
      default: return 'plaintext';
    }
  }

  getMonacoLanguage(filePath) {
    const type = this.detectFileType(filePath);
    return type === 'plaintext' ? 'javascript' : type;
  }

  getLangBadge(filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'tsx': return 'TSX';
      case 'jsx': return 'JSX';
      case 'ts': return 'TS';
      case 'js':
      case 'mjs':
      case 'cjs': return 'JS';
      case 'html': return 'HTML';
      case 'ejs': return 'EJS';
      case 'css': return 'CSS';
      case 'json': return '{}';
      default: return 'TXT';
    }
  }

  syncEditorToActiveFile() {
    const fileObj = this.files.get(this.activeFilePath);
    if (!fileObj) return;

    if (this.editor) {
      const lang = this.getMonacoLanguage(this.activeFilePath);
      const currentModel = this.editor.getModel();
      if (currentModel) {
        currentModel.dispose();
      }
      const model = monaco.editor.createModel(fileObj.content, lang);
      this.editor.setModel(model);
    } else if (this.fallbackTextarea) {
      this.fallbackTextarea.value = fileObj.content;
    }
  }

  renderExplorerTree() {
    if (!this.el.fileTreeContainer) return;
    this.el.fileTreeContainer.innerHTML = '';
    for (const [filePath] of this.files) {
      const node = document.createElement('div');
      node.className = `tree-node ${filePath === this.activeFilePath ? 'active' : ''}`;
      const ext = filePath.split('.').pop()?.toLowerCase() || '';

      node.innerHTML = `
        <div class="tree-left">
          <span class="tab-lang-icon badge-${ext}">${this.getLangBadge(filePath)}</span>
          <span>${filePath}</span>
        </div>
        <div class="tree-actions">
          <button class="mini-btn btn-delete" title="Delete File">×</button>
        </div>
      `;

      node.querySelector('.btn-delete').onclick = (e) => {
        e.stopPropagation();
        this.deleteFile(filePath);
      };

      node.onclick = () => this.switchActiveFile(filePath);
      this.el.fileTreeContainer.appendChild(node);
    }
  }

  renderTabs() {
    if (!this.el.tabsBar) return;
    this.el.tabsBar.innerHTML = '';

    if (!this.openTabs || this.openTabs.length === 0) {
      const fallback = this.activeFilePath || Array.from(this.files.keys())[0] || 'index.js';
      this.openTabs = [fallback];
      if (!this.files.has(fallback)) {
        this.files.set(fallback, { path: fallback, content: '// ' + fallback, type: 'js' });
      }
      this.activeFilePath = fallback;
    }

    for (const filePath of this.openTabs) {
      const tab = document.createElement('div');
      tab.className = `tab-item ${filePath === this.activeFilePath ? 'active' : ''}`;
      const ext = filePath.split('.').pop()?.toLowerCase() || '';

      tab.innerHTML = `
        <span class="tab-lang-icon badge-${ext}">${this.getLangBadge(filePath)}</span>
        <span>${filePath}</span>
        <span class="tab-close-btn" title="Close Tab">×</span>
      `;

      tab.onclick = () => this.switchActiveFile(filePath);
      tab.querySelector('.tab-close-btn').onclick = (e) => {
        e.stopPropagation();
        this.closeTab(filePath);
      };

      this.el.tabsBar.appendChild(tab);
    }
  }

  switchActiveFile(filePath) {
    if (!this.files.has(filePath)) return;
    if (this.editor && this.activeFilePath && this.files.has(this.activeFilePath)) {
      this.files.get(this.activeFilePath).content = this.editor.getValue();
    } else if (this.fallbackTextarea && this.activeFilePath && this.files.has(this.activeFilePath)) {
      this.files.get(this.activeFilePath).content = this.fallbackTextarea.value;
    }

    if (!this.openTabs.includes(filePath)) {
      this.openTabs.push(filePath);
    }

    this.activeFilePath = filePath;
    this.saveFiles();
    this.renderExplorerTree();
    this.renderTabs();
    this.syncEditorToActiveFile();
  }

  closeTab(filePath) {
    if (this.openTabs.length <= 1 && this.files.has(filePath)) return;
    this.openTabs = this.openTabs.filter((t) => t !== filePath);
    if (this.openTabs.length === 0) {
      const firstAvailable = Array.from(this.files.keys())[0];
      if (firstAvailable) this.openTabs.push(firstAvailable);
    }
    if (this.activeFilePath === filePath) {
      this.activeFilePath = this.openTabs[0] || '';
      if (this.activeFilePath) {
        this.syncEditorToActiveFile();
      }
    }
    this.saveFiles();
    this.renderTabs();
    this.renderExplorerTree();
  }

  openCreateModal() {
    if (!this.el.modalOverlay) {
      this.el.modalOverlay = document.getElementById('modalOverlay');
    }
    if (!this.el.modalOverlay) return;
    this.el.modalTitle.textContent = 'Create New File';
    this.el.modalInput.value = '';
    this.el.modalError.textContent = '';
    this.el.modalOverlay.classList.remove('hidden');
    this.el.modalOverlay.style.display = 'flex';
    setTimeout(() => {
      if (this.el.modalInput) this.el.modalInput.focus();
    }, 50);
  }

  closeModal() {
    if (!this.el.modalOverlay) return;
    this.el.modalOverlay.classList.add('hidden');
    this.el.modalOverlay.style.display = 'none';
    this.el.modalError.textContent = '';
  }

  confirmModalAction() {
    const raw = this.el.modalInput.value.trim();
    if (!raw) {
      this.el.modalError.textContent = 'Filename cannot be empty.';
      return;
    }

    if (this.files.has(raw)) {
      this.el.modalError.textContent = 'File already exists.';
      return;
    }

    let defaultContent = `// ${raw}\n`;
    if (raw.endsWith('.html')) {
      defaultContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Live Web Preview</title>
  <!-- Modern CSS Package: Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="styles.css">
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen p-8 flex flex-col items-center justify-center">
  <div id="root" class="max-w-md w-full bg-slate-800 p-6 rounded-xl shadow-2xl border border-slate-700">
    <h1 class="text-2xl font-bold text-sky-400 mb-2">Universal Node IDE</h1>
    <p class="text-slate-300 text-sm mb-4">HTML, CSS, JavaScript & DOM manipulation ready.</p>
    <button id="btnClick" class="w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold py-2 px-4 rounded-lg transition shadow-md">
      Click to Update innerHTML
    </button>
    <div id="output" class="mt-4 p-3 bg-slate-900 rounded-lg text-xs font-mono text-emerald-400 border border-slate-800">
      Ready for interaction
    </div>
  </div>

  <script>
    document.getElementById('btnClick').addEventListener('click', () => {
      document.getElementById('output').innerHTML = '<strong>Updated via innerHTML:</strong> ' + new Date().toLocaleTimeString();
    });
  </script>
</body>
</html>
`;
    } else if (raw.endsWith('.css')) {
      defaultContent = `/* Universal Stylesheet */
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background-color: #0f172a;
  color: #f8fafc;
}

.card {
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 1.5rem;
}
`;
    } else if (raw.endsWith('.ejs')) {
      defaultContent = `<!-- EJS Server-Side Template -->
<div style="font-family: sans-serif; padding: 24px; background: #1e293b; color: #f8fafc; border-radius: 8px; max-width: 500px; margin: 20px auto; border: 1px solid #334155;">
  <h2 style="color: #38bdf8; margin-top: 0;"><%= title %></h2>
  <p><%= message %></p>
  <ul style="padding-left: 20px;">
    <% items.forEach(function(item) { %>
      <li style="margin-bottom: 6px;"><%= item %></li>
    <% }); %>
  </ul>
  <div style="margin-top: 16px; padding: 8px 12px; background: #0f172a; border-radius: 4px; font-size: 13px; color: #a5f3fc;">
    User: <strong><%= user.name %></strong> (<%= user.role %>)
  </div>
</div>
`;
    } else if (raw.endsWith('.jsx')) {
      defaultContent = `import React, { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '32px', background: '#0f172a', color: '#f8fafc', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ background: '#1e293b', padding: '24px', borderRadius: '12px', border: '1px solid #334155', maxWidth: '400px', width: '100%' }}>
        <h1 style={{ color: '#38bdf8', fontSize: '20px', marginTop: 0 }}>React / JSX in Node IDE</h1>
        <p style={{ color: '#94a3b8', fontSize: '14px' }}>Interactive React component with live state management.</p>
        <button
          onClick={() => setCount(count + 1)}
          style={{ padding: '10px 16px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', width: '100%' }}
        >
          Count: {count}
        </button>
      </div>
    </div>
  );
}
`;
    } else if (raw.endsWith('.json')) {
      defaultContent = `{\n  "name": "project",\n  "version": "1.0.0"\n}\n`;
    }

    this.files.set(raw, {
      path: raw,
      content: defaultContent,
      type: this.detectFileType(raw),
    });

    this.closeModal();
    this.switchActiveFile(raw);
    this.saveFiles();
    this.renderTabs();
    this.renderExplorerTree();
    this.syncChromeTabsFromFiles();
  }

  deleteFile(filePath) {
    if (this.files.size <= 1) {
      alert('Cannot delete the only file in the project.');
      return;
    }
    if (confirm(`Delete "${filePath}"?`)) {
      this.files.delete(filePath);
      this.closeTab(filePath);
      if (this.entryFile === filePath) {
        this.entryFile = Array.from(this.files.keys())[0];
      }
      this.saveFiles();
      this.syncChromeTabsFromFiles();
    }
  }

  setStatus(type, text) {
    this.el.statusBadge.className = `status-pill ${type}`;
    this.el.statusBadgeText.textContent = text;
  }

  appendConsole(text, className = 'log-stdout') {
    if (this.el.consolePlaceholder) {
      this.el.consolePlaceholder.style.display = 'none';
    }
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    this.el.consoleOutput.appendChild(span);
    this.el.consoleOutput.scrollTop = this.el.consoleOutput.scrollHeight;
  }

  clearConsole() {
    this.el.consoleOutput.innerHTML = '';
    if (this.el.consolePlaceholder) {
      this.el.consolePlaceholder.style.display = 'flex';
      this.el.consoleOutput.appendChild(this.el.consolePlaceholder);
    }
  }

  // --- Execution Engine ---
  async executeCode() {
    if (this.isExecuting) {
      // Cleanly stop any existing running server/process before starting new run
      await this.stopCode();
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    if (this.editor && this.activeFilePath && this.files.has(this.activeFilePath)) {
      this.files.get(this.activeFilePath).content = this.editor.getValue();
    } else if (this.fallbackTextarea && this.activeFilePath && this.files.has(this.activeFilePath)) {
      this.files.get(this.activeFilePath).content = this.fallbackTextarea.value;
    }

    this.isExecuting = true;
    this.el.btnRun.disabled = true;
    this.el.btnStop.disabled = false;
    this.el.durationBadge.classList.add('hidden');
    this.el.durationBadge.hidden = true;
    this.setStatus('status-running', 'Running...');
    this.clearConsole();

    // Switch right workbench to console tab
    this.switchWorkbenchPanel('panelConsole');

    const projectFileList = Array.from(this.files.values()).map((f) => ({
      path: f.path,
      content: f.content,
      type: f.type,
    }));

    let chosenEntry = this.entryFile;
    if (/\.(js|mjs|cjs|ts|tsx|jsx|html|htm|css|ejs|json)$/i.test(this.activeFilePath)) {
      chosenEntry = this.activeFilePath;
    }

    // Auto-update HTML preview if HTML, EJS, CSS, JSX file, or if code uses innerHTML / DOM
    const hasDomOrHtml =
      /\.(html|htm|ejs|css|jsx|tsx)$/i.test(this.activeFilePath) ||
      projectFileList.some((f) => /\.(html|htm|ejs|jsx)$/i.test(f.path) || /(?:innerHTML|document\.)/i.test(f.content));
    if (hasDomOrHtml) {
      this.generatePreview();
    }

    const payload = {
      projectId: 'main-app',
      entryFile: chosenEntry,
      files: projectFileList,
      options: {
        timeoutMs: 1800000, // 30 minutes: persistent server execution
        memoryMb: 512,
      },
    };

    const startTime = Date.now();

    try {
      const response = await fetch('/api/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        this.setStatus('status-error', 'Failed');
        this.appendConsole(`Error: ${data.message || data.error}\n`, 'log-error');
        this.finalizeRun(Date.now() - startTime, false);
        return;
      }

      this.activeJobId = data.jobId;
      this.connectEventStream(data.jobId, startTime);
    } catch (err) {
      this.setStatus('status-error', 'Network Error');
      this.appendConsole(`Error: ${err.message}\n`, 'log-error');
      this.finalizeRun(Date.now() - startTime, false);
    }
  }

  detectPortInOutput(text) {
    if (!text || typeof text !== 'string') return;

    // Detect Port 3000 conflict (Code Editor reserved port)
    if (
      text.includes('PORT_CONFLICT') ||
      text.includes('PORT3000') ||
      (text.includes('EADDRINUSE') && (text.includes('3000') || text.includes(':::3000'))) ||
      text.includes('Port 3000 is reserved') ||
      text.includes('Port 3000 is strictly reserved')
    ) {
      this.activeServerPort = null;
      this.setStatus('status-error', 'Port 3000 Reserved');
      return;
    }

    // Detect active listening port strictly from positive server lifecycle stdout announcements
    const portMatch =
      text.match(/(?:listening|started|running|server\s+online|server\s+ready)\s+(?:at|on|port)?\s*[:\s]?(\d{4,5})/i) ||
      text.match(/(?:http:\/\/|https:\/\/)(?:localhost|127\.0\.0\.1|0\.0\.0\.0|::):(\d{4,5})/i);

    if (portMatch && portMatch[1]) {
      const port = portMatch[1];
      if (port === '3000') {
        this.activeServerPort = null;
        this.setStatus('status-error', 'Port 3000 Reserved');
        return;
      }
      this.activeServerPort = port;
      this.setStatus('status-running', `🟢 Running (:${port})`);
      this.el.btnStop.disabled = false;
      this.el.btnRun.disabled = false;

      // Update Thunder Client input URL
      if (this.el.thunderUrl) {
        const curUrl = this.el.thunderUrl.value.trim();
        if (!curUrl || curUrl.includes('localhost:300') || curUrl.includes('localhost:')) {
          this.el.thunderUrl.value = `http://localhost:${port}/`;
        }
      }

      // Sync active port to preview iframe
      if (this.el.previewIframe && this.el.previewIframe.contentWindow) {
        try {
          this.el.previewIframe.contentWindow.postMessage({ type: 'set_active_port', port }, '*');
        } catch (e) {}
      }

      // Sync live server response directly to preview so rendered HTML and forms display immediately!
      this.syncLiveServerToPreview(port);
    }
  }

  async syncLiveServerToPreview(port) {
    if (!port) return;
    try {
      await new Promise((r) => setTimeout(r, 180));
      const res = await fetch('/api/v1/proxy-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Target-Port': String(port) },
        body: JSON.stringify({
          url: `http://localhost:${port}/`,
          method: 'GET',
          headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        }),
      });
      const data = await res.json();
      const content = data.data !== undefined ? data.data : data.body;
      if (content && typeof content === 'string' && (content.includes('<') && content.includes('>'))) {
        if (this.el.previewIframe) {
          this.el.previewIframe.srcdoc = content;
        }
        if (this.el.thunderPreviewIframe) {
          this.el.thunderPreviewIframe.srcdoc = content;
        }
        // Switch right workbench to preview panel so user immediately sees the live HTML/CSS rendered page!
        this.switchWorkbenchPanel('panelPreview', true);
      }
    } catch (err) {
      console.debug('Live server preview sync deferred:', err);
    }
  }

  connectEventStream(jobId, startTime) {
    if (this.activeEventSource) this.activeEventSource.close();

    this.activeEventSource = new EventSource(`/api/v1/jobs/${jobId}/stream`);

    this.activeEventSource.onmessage = (event) => {
      try {
        const chunk = JSON.parse(event.data);

        if (chunk.type === 'stdout') {
          this.appendConsole(chunk.data, 'log-stdout');
          this.detectPortInOutput(chunk.data);
        } else if (chunk.type === 'stderr') {
          this.appendConsole(chunk.data, 'log-stderr');
          if (chunk.data.includes('INFINITE_LOOP_DETECTED') || chunk.data.includes('Potential infinite loop detected')) {
            this.activeServerPort = null;
            this.setStatus('status-error', 'Infinite Loop Blocked');
          }
          // Inspect error chunks for Port 3000 collision warnings without setting running port
          if (
            chunk.data.includes('PORT_CONFLICT') ||
            chunk.data.includes('PORT3000') ||
            (chunk.data.includes('EADDRINUSE') && (chunk.data.includes('3000') || chunk.data.includes(':::3000'))) ||
            chunk.data.includes('Port 3000 is reserved') ||
            chunk.data.includes('Port 3000 is strictly reserved')
          ) {
            this.activeServerPort = null;
            this.setStatus('status-error', 'Port 3000 Reserved');
            if (this.el.footerServerPort) {
              this.el.footerServerPort.textContent = '⚠️ Port: 3000 (Reserved)';
              this.el.footerServerPort.className = 'footer-item log-error';
            }
            if (this.el.thunderStatusText) {
              this.el.thunderStatusText.textContent = '⚠️ Port 3000 Reserved (Change to 3001+)';
              this.el.thunderStatusDot.className = 'server-status-dot error';
            }
          }
        } else if (chunk.type === 'compile_error') {
          const e = chunk.data;
          const isInfiniteLoop = (typeof e === 'string' && (e.includes('INFINITE_LOOP_DETECTED') || e.includes('Potential infinite loop detected'))) ||
                                 (e && (e.code === 'INFINITE_LOOP_DETECTED' || (e.message && e.message.includes('infinite loop'))));
          const isPort3000 = (typeof e === 'string' && (e.includes('PORT3000') || e.includes('PORT_CONFLICT') || e.includes('RESERVED_PORT_3000') || e.includes('Port 3000 is strictly reserved') || e.includes('COMPILER-E3000'))) ||
                             (e && (e.code === 'RESERVED_PORT_3000' || e.code === 'PORT3000' || (e.message && e.message.includes('Port 3000'))));
          if (typeof e === 'string') {
            this.appendConsole(e, 'log-stderr');
          } else if (e && e.formatted) {
            this.appendConsole(e.formatted, 'log-stderr');
          } else if (e) {
            this.appendConsole(`/workspace/${e.file}:${e.line}:${e.column} - error ${e.code || 'TS'}: ${e.message}\n`, 'log-stderr');
          }
          const isHtmlError = (typeof e === 'string' && (e.includes('HTML_') || e.includes('CSS_') || e.includes('EJS_') || e.includes('HTML/CSS Compiler Diagnostic') || e.includes('EJS Template Syntax Error'))) ||
                              (e && (String(e.code).startsWith('HTML_') || String(e.code).startsWith('CSS_') || String(e.code).startsWith('EJS_')));
          if (isPort3000) {
            this.setStatus('status-error', 'Port 3000 Reserved');
            if (this.el.footerServerPort) {
              this.el.footerServerPort.textContent = '⚠️ Port: 3000 (Reserved)';
              this.el.footerServerPort.className = 'footer-item log-error';
            }
            if (this.el.thunderStatusText) {
              this.el.thunderStatusText.textContent = '⚠️ Port 3000 Reserved (Change to 3001+)';
              this.el.thunderStatusDot.className = 'server-status-dot error';
            }
          } else if (isInfiniteLoop) {
            this.setStatus('status-error', 'Infinite Loop Blocked');
          } else if (isHtmlError) {
            this.setStatus('status-error', 'HTML/CSS Error');
          } else {
            this.setStatus('status-error', 'Compile Error');
          }
        } else if (chunk.type === 'runtime_error') {
          const msg = chunk.data?.message || chunk.data;
          this.appendConsole(`${msg}\n`, 'log-stderr');
          this.activeServerPort = null;
          this.setStatus('status-error', 'Runtime Error');
        } else if (chunk.type === 'status') {
          const st = chunk.data?.status;
          if (st === 'SUCCESS' && !this.activeServerPort) this.setStatus('status-ready', 'Ready');
          else if (st === 'TIMEOUT') {
            this.activeServerPort = null;
            this.setStatus('status-error', 'Timed Out');
          } else if (st === 'COMPILATION_ERROR') {
            this.activeServerPort = null;
            const currentStatus = this.el.statusBadgeText?.textContent;
            if (currentStatus !== 'Infinite Loop Blocked' && currentStatus !== 'Port 3000 Reserved') {
              this.setStatus('status-error', 'Compile Error');
            }
          } else if (st === 'RUNTIME_ERROR') {
            this.activeServerPort = null;
            this.setStatus('status-error', 'Runtime Error');
          }
        } else if (chunk.type === 'preview') {
          if (chunk.data?.bundledHtml && this.el.previewIframe) {
            this.el.previewIframe.srcdoc = chunk.data.bundledHtml;
            // Switch to preview panel if user is running web preview
            if (this.activeFilePath && /\.(html|htm|css|ejs)$/i.test(this.activeFilePath)) {
              this.switchWorkbenchPanel('panelPreview', true);
            }
          }
        } else if (chunk.type === 'alert') {
          this.handleSystemAlert(chunk.data);
        } else if (chunk.type === 'endpoints') {
          // No-op: detected port/discovered endpoints feature removed per user request
        } else if (chunk.type === 'metrics') {
          const duration = chunk.data.executionDurationMs || (Date.now() - startTime);
          this.el.durationValue.textContent = `${duration} ms`;
          this.el.durationBadge.classList.remove('hidden');
          this.el.durationBadge.hidden = false;
        } else if (chunk.type === 'exit') {
          // When a process exits, any running server has stopped!
          const exitCode = chunk.data?.exitCode ?? 0;
          this.activeServerPort = null;
          this.finalizeRun(Date.now() - startTime, exitCode === 0, true);
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    this.activeEventSource.onerror = () => {
      if (this.activeServerPort) {
        // Server is actively listening in background - keep port active and Stop button enabled
        this.isExecuting = false;
        this.el.btnRun.disabled = false;
        this.el.btnStop.disabled = false;
        if (this.activeEventSource) {
          this.activeEventSource.close();
          this.activeEventSource = null;
        }
      } else {
        this.finalizeRun(Date.now() - startTime, true, true);
      }
    };
  }

  async stopCode() {
    if (!this.activeJobId && !this.activeServerPort) return;
    this.appendConsole('\n[Execution terminated by user]\n', 'log-dim');
    const jobId = this.activeJobId;
    if (jobId) {
      try {
        await fetch(`/api/v1/jobs/${jobId}/cancel`, { method: 'POST' });
      } catch {}
    }
    this.finalizeRun(0, false, true);
  }

  finalizeRun(durationMs, success, force = false) {
    if (this.activeServerPort && !force) {
      // Background server still active; preserve running state and Keep Stop button functional
      this.isExecuting = false;
      this.el.btnRun.disabled = false;
      this.el.btnStop.disabled = false;
      return;
    }

    this.isExecuting = false;
    this.el.btnRun.disabled = false;
    this.el.btnStop.disabled = true;
    if (this.activeEventSource) {
      this.activeEventSource.close();
      this.activeEventSource = null;
    }
    if (this.activeServerPort) {
      this.activeServerPort = null;
    }
    if (durationMs > 0 && (this.el.durationBadge.classList.contains('hidden') || this.el.durationBadge.hidden)) {
      this.el.durationValue.textContent = `${durationMs} ms`;
      this.el.durationBadge.classList.remove('hidden');
      this.el.durationBadge.hidden = false;
    }
    const currentStatus = this.el.statusBadgeText?.textContent;
    if (!success && (currentStatus === 'Infinite Loop Blocked' || currentStatus === 'Port 3000 Reserved')) {
      // Retain the specific diagnostic error pill
    } else {
      this.setStatus(success ? 'status-ready' : 'status-error', success ? 'Ready' : 'Exited with errors');
    }
  }

  listenToSystemAlerts() {
    try {
      const alertSource = new EventSource('/api/v1/alerts/stream');
      alertSource.onmessage = (event) => {
        try {
          const alertData = JSON.parse(event.data);
          this.handleSystemAlert(alertData);
        } catch (e) {}
      };
    } catch (e) {
      console.warn('System alert stream initialization deferred', e);
    }
  }

  dismissSystemAlert() {
    if (!this.el.systemAlertBanner) return;
    this.el.systemAlertBanner.classList.add('hidden');
    this.el.systemAlertBanner.hidden = true;
    if (this.alertAutoDismissTimer) {
      clearTimeout(this.alertAutoDismissTimer);
      this.alertAutoDismissTimer = null;
    }
  }

  handleSystemAlert(alert) {
    if (!alert || !alert.message || !this.el.systemAlertBanner) return;

    const message = String(alert.message).trim();
    if (!message) return;

    const severity = (alert.severity || 'WARNING').toUpperCase();
    this.el.systemAlertBanner.className = `system-alert-banner ${
      severity === 'CRITICAL' ? '' : severity === 'INFO' ? 'alert-info' : 'alert-warning'
    }`;
    const icon = severity === 'CRITICAL' ? '⚡' : severity === 'INFO' ? 'ℹ️' : '⚠️';
    if (this.el.alertBannerIcon) {
      this.el.alertBannerIcon.textContent = icon;
    }
    const category = alert.category || 'SYSTEM';
    if (this.el.alertBannerText) {
      this.el.alertBannerText.textContent = `${icon} [${category}] ${message}`;
    }

    this.el.systemAlertBanner.classList.remove('hidden');
    this.el.systemAlertBanner.hidden = false;

    this.appendConsole(
      `\n[SYSTEM ALERT - ${severity}]: ${message}\n[FAULT ISOLATION]: Sandbox error isolated. Host platform is 100% stable.\n`,
      'log-error'
    );

    // Auto-dismiss non-critical alerts after 8 seconds so user workflow is uninterrupted
    if (this.alertAutoDismissTimer) {
      clearTimeout(this.alertAutoDismissTimer);
      this.alertAutoDismissTimer = null;
    }
    if (severity !== 'CRITICAL') {
      this.alertAutoDismissTimer = setTimeout(() => {
        this.dismissSystemAlert();
      }, 8000);
    }
  }

  // --- Chrome Multi-Tab Browser & Preview Manager ---
  initChromeBrowser() {
    if (this.el.btnChromeNewTab) {
      this.el.btnChromeNewTab.onclick = () => {
        const defaultPage = Array.from(this.files.keys()).find((k) => /\.(html|htm|ejs)$/i.test(k)) || 'index.html';
        this.openChromeTab('/' + defaultPage, defaultPage);
      };
    }

    if (this.el.btnBrowserBack) {
      this.el.btnBrowserBack.onclick = () => this.browserGoBack();
    }
    if (this.el.btnBrowserForward) {
      this.el.btnBrowserForward.onclick = () => this.browserGoForward();
    }
    if (this.el.btnBrowserHome) {
      this.el.btnBrowserHome.onclick = () => this.browserGoHome();
    }
    if (this.el.btnBrowserGo) {
      this.el.btnBrowserGo.onclick = () => this.navigateActiveBrowserTab(this.el.browserUrlInput?.value);
    }
    if (this.el.browserUrlInput) {
      this.el.browserUrlInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          this.navigateActiveBrowserTab(this.el.browserUrlInput.value);
        }
      };
    }

    // Responsive Device Switcher
    const deviceBtns = [
      { el: this.el.btnViewDesktop, width: '100%' },
      { el: this.el.btnViewTablet, width: '768px' },
      { el: this.el.btnViewMobile, width: '375px' },
    ];
    deviceBtns.forEach(({ el, width }) => {
      if (el) {
        el.onclick = () => {
          deviceBtns.forEach((b) => b.el?.classList.toggle('active', b.el === el));
          this.setBrowserDeviceMode(width);
        };
      }
    });

    if (this.el.btnBrowserPopout) {
      this.el.btnBrowserPopout.onclick = () => this.openBrowserPopout();
    }

    // Listen to iframe in-page navigation clicks (<a> links, form submits)
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'preview_navigated') {
        const navUrl = event.data.url;
        if (event.data.target === '_blank') {
          this.openChromeTab(navUrl, navUrl.replace(/^\//, '') || 'New Tab', true);
        } else {
          this.navigateActiveBrowserTab(navUrl);
        }
      }
    });

    this.syncChromeTabsFromFiles();
  }

  syncChromeTabsFromFiles() {
    const htmlFiles = Array.from(this.files.keys()).filter((k) =>
      /\.(html|htm|ejs)$/i.test(k)
    );

    if (this.browserTabs.length === 0) {
      if (htmlFiles.length > 0) {
        htmlFiles.forEach((file) => {
          const tabId = 'tab-' + Math.random().toString(36).substr(2, 6);
          this.browserTabs.push({
            id: tabId,
            title: file,
            url: '/' + file,
            history: ['/' + file],
            historyIndex: 0,
            srcdoc: '',
          });
        });
      } else {
        this.browserTabs.push({
          id: 'tab-default',
          title: 'index.html',
          url: '/index.html',
          history: ['/index.html'],
          historyIndex: 0,
          srcdoc: '',
        });
      }
      this.activeBrowserTabId = this.browserTabs[0].id;
    } else {
      // If a new HTML/EJS file was created that doesn't have a tab yet, add it
      htmlFiles.forEach((file) => {
        const clean = file.replace(/^\//, '');
        const hasTab = this.browserTabs.some(
          (t) => t.url.replace(/^\//, '') === clean || t.title === clean
        );
        if (!hasTab && this.browserTabs.length < 8) {
          this.browserTabs.push({
            id: 'tab-' + Math.random().toString(36).substr(2, 6),
            title: clean,
            url: '/' + clean,
            history: ['/' + clean],
            historyIndex: 0,
            srcdoc: '',
          });
        }
      });
    }

    this.renderChromeTabs();
  }

  renderChromeTabs() {
    if (!this.el.chromeTabsList) return;
    this.el.chromeTabsList.innerHTML = '';

    const activeTab = this.browserTabs.find((t) => t.id === this.activeBrowserTabId) || this.browserTabs[0];
    if (activeTab) {
      this.activeBrowserTabId = activeTab.id;
      if (this.el.browserUrlInput) {
        this.el.browserUrlInput.value = activeTab.url || '/index.html';
      }
      if (this.el.btnBrowserBack) {
        this.el.btnBrowserBack.disabled = activeTab.historyIndex <= 0;
      }
      if (this.el.btnBrowserForward) {
        this.el.btnBrowserForward.disabled = activeTab.historyIndex >= activeTab.history.length - 1;
      }
    }

    this.browserTabs.forEach((tab) => {
      const tabEl = document.createElement('div');
      tabEl.className = `chrome-tab ${tab.id === this.activeBrowserTabId ? 'active' : ''}`;

      const iconClass = tab.title.endsWith('.ejs') ? 'icon-ejs' : (tab.title.endsWith('.jsx') ? 'icon-react' : '');
      const iconSvg = tab.title.endsWith('.ejs')
        ? `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`
        : `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

      tabEl.innerHTML = `
        <span class="chrome-tab-icon ${iconClass}">${iconSvg}</span>
        <span class="chrome-tab-title" title="${tab.title}">${tab.title}</span>
        <button class="chrome-tab-close" title="Close tab">&times;</button>
      `;

      tabEl.onclick = () => this.switchChromeTab(tab.id);

      const closeBtn = tabEl.querySelector('.chrome-tab-close');
      closeBtn.onclick = (e) => this.closeChromeTab(tab.id, e);

      this.el.chromeTabsList.appendChild(tabEl);
    });
  }

  openChromeTab(url = '/index.html', title = null, autoActivate = true) {
    const cleanUrl = url.startsWith('/') || url.startsWith('http') ? url : '/' + url;
    const cleanTitle = title || cleanUrl.replace(/^\//, '') || 'New Tab';
    const tabId = 'tab-' + Math.random().toString(36).substr(2, 6);

    const newTab = {
      id: tabId,
      title: cleanTitle,
      url: cleanUrl,
      history: [cleanUrl],
      historyIndex: 0,
      srcdoc: '',
    };
    this.browserTabs.push(newTab);

    if (autoActivate) {
      this.switchChromeTab(tabId);
    } else {
      this.renderChromeTabs();
    }
    return newTab;
  }

  switchChromeTab(tabId) {
    this.activeBrowserTabId = tabId;
    this.renderChromeTabs();
    this.generatePreview(tabId);
  }

  closeChromeTab(tabId, event) {
    if (event) event.stopPropagation();
    const idx = this.browserTabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;

    this.browserTabs.splice(idx, 1);

    if (this.browserTabs.length === 0) {
      this.openChromeTab('/index.html', 'index.html', true);
      return;
    }

    if (this.activeBrowserTabId === tabId) {
      const nextTab = this.browserTabs[Math.min(idx, this.browserTabs.length - 1)];
      this.activeBrowserTabId = nextTab.id;
      this.switchChromeTab(nextTab.id);
    } else {
      this.renderChromeTabs();
    }
  }

  navigateActiveBrowserTab(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return;
    const activeTab = this.browserTabs.find((t) => t.id === this.activeBrowserTabId) || this.browserTabs[0];
    if (!activeTab) return;

    let clean = rawUrl.trim();
    if (!clean.startsWith('http://') && !clean.startsWith('https://') && !clean.startsWith('/')) {
      clean = '/' + clean;
    }

    if (activeTab.url !== clean) {
      activeTab.history = activeTab.history.slice(0, activeTab.historyIndex + 1);
      activeTab.history.push(clean);
      activeTab.historyIndex = activeTab.history.length - 1;
      activeTab.url = clean;
      activeTab.title = clean.replace(/^\//, '').split('?')[0].split('#')[0] || 'index.html';
    }

    this.renderChromeTabs();
    this.generatePreview(activeTab.id);
  }

  browserGoBack() {
    const activeTab = this.browserTabs.find((t) => t.id === this.activeBrowserTabId);
    if (activeTab && activeTab.historyIndex > 0) {
      activeTab.historyIndex--;
      activeTab.url = activeTab.history[activeTab.historyIndex];
      activeTab.title = activeTab.url.replace(/^\//, '').split('?')[0].split('#')[0] || 'index.html';
      this.renderChromeTabs();
      this.generatePreview(activeTab.id);
    }
  }

  browserGoForward() {
    const activeTab = this.browserTabs.find((t) => t.id === this.activeBrowserTabId);
    if (activeTab && activeTab.historyIndex < activeTab.history.length - 1) {
      activeTab.historyIndex++;
      activeTab.url = activeTab.history[activeTab.historyIndex];
      activeTab.title = activeTab.url.replace(/^\//, '').split('?')[0].split('#')[0] || 'index.html';
      this.renderChromeTabs();
      this.generatePreview(activeTab.id);
    }
  }

  browserGoHome() {
    const defaultPage = Array.from(this.files.keys()).find((k) => /\.(html|htm|ejs)$/i.test(k)) || 'index.html';
    this.navigateActiveBrowserTab('/' + defaultPage);
  }

  setBrowserDeviceMode(width) {
    this.browserDeviceWidth = width;
    if (this.el.previewIframe) {
      this.el.previewIframe.style.width = width;
      this.el.previewIframe.classList.toggle('device-tablet', width === '768px');
      this.el.previewIframe.classList.toggle('device-mobile', width === '375px');
    }
  }

  openBrowserPopout() {
    if (!this.el.previewIframe) return;
    const content = this.el.previewIframe.srcdoc;
    if (!content) return;
    const win = window.open('', '_blank');
    if (win) {
      win.document.open();
      win.document.write(content);
      win.document.close();
    }
  }

  async generatePreview(targetTabId = null) {
    const activeTab = this.browserTabs.find((t) => t.id === (targetTabId || this.activeBrowserTabId)) || this.browserTabs[0];

    const list = Array.from(this.files.values()).map((f) => ({ path: f.path, content: f.content }));
    let entryHtml = 'index.html';

    if (activeTab && activeTab.url) {
      const cleanPath = activeTab.url.replace(/^\//, '').split('?')[0].split('#')[0];
      if (this.files.has(cleanPath)) {
        entryHtml = cleanPath;
      } else if (this.files.has('views/' + cleanPath)) {
        entryHtml = 'views/' + cleanPath;
      } else if (this.files.has(cleanPath + '.html')) {
        entryHtml = cleanPath + '.html';
      } else if (this.files.has('views/' + cleanPath + '.html')) {
        entryHtml = 'views/' + cleanPath + '.html';
      } else if (cleanPath === 'success' || cleanPath === 'success.html' || cleanPath === 'sucess' || cleanPath === 'sucess.html') {
        const found = Array.from(this.files.keys()).find((k) => k.includes('success') || k.includes('sucess'));
        entryHtml = found || cleanPath || 'index.html';
      } else if (this.files.has('views/index.html')) {
        entryHtml = 'views/index.html';
      } else if (this.files.has('index.html')) {
        entryHtml = 'index.html';
      } else {
        const anyHtmlOrEjs = Array.from(this.files.keys()).find((k) => k.endsWith('.html') || k.endsWith('.ejs'));
        entryHtml = anyHtmlOrEjs || cleanPath || 'index.html';
      }
    } else if (this.files.has('views/index.html')) {
      entryHtml = 'views/index.html';
    } else if (this.files.has('index.html')) {
      entryHtml = 'index.html';
    } else if (this.activeFilePath.endsWith('.html') || this.activeFilePath.endsWith('.ejs')) {
      entryHtml = this.activeFilePath;
    } else {
      const anyHtmlOrEjs = Array.from(this.files.keys()).find((k) => k.endsWith('.html') || k.endsWith('.ejs'));
      entryHtml = anyHtmlOrEjs || 'index.html';
    }

    try {
      const res = await fetch('/api/v1/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'preview-app',
          files: list,
          entryHtml,
          activeServerPort: this.activeServerPort,
        }),
      });
      const data = await res.json();
      if (res.ok && data.bundledHtml) {
        if (activeTab) {
          activeTab.srcdoc = data.bundledHtml;
        }
        if (this.el.previewIframe) {
          this.el.previewIframe.srcdoc = data.bundledHtml;
        }
      }
    } catch (err) {
      console.error('Preview generation error:', err);
    }
  }

  injectCurrentCodeToInnerHtml() {
    const content = this.editor
      ? this.editor.getValue()
      : (this.fallbackTextarea ? this.fallbackTextarea.value : (this.files.get(this.activeFilePath)?.content || ''));
    const trimmed = content.trim();

    // Only treat as pure HTML if the file starts with an HTML tag or DOCTYPE
    const isPureHtml = trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || (trimmed.startsWith('<') && !trimmed.startsWith('<=') && !trimmed.startsWith('<<'));

    let docHtml = '';
    if (isPureHtml) {
      docHtml = content;
    } else {
      // Check if this JS code returns or defines an HTML template string (like renderFormPage())
      const templateHtmlMatch = content.match(/[`'"](<!DOCTYPE[\s\S]*?>[\s\S]*?<\/html>|<html[\s\S]*?>[\s\S]*?<\/html>)[`'"]/i) ||
                                content.match(/[`'"](<!DOCTYPE[\s\S]*?>[\s\S]*?)[`'"]/i) ||
                                content.match(/return\s*[`'"]([\s\S]*?<[a-z][\s\S]*?>[\s\S]*?)[`'"]\s*;/i);
      if (templateHtmlMatch) {
        docHtml = templateHtmlMatch[1].replace(/\$\{[^}]*\}/g, '').trim();
        if (docHtml.toLowerCase().startsWith('<!doctype') && !docHtml.toLowerCase().includes('</html>')) {
          docHtml += '\n</html>';
        }
      } else {
        // Execute JavaScript code live so innerHTML and DOM manipulation render in the container!
        const safeScriptContent = content.replace(/<\/script/gi, '<\\/script');
        docHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 16px; color: #1e293b; background: #ffffff; }
    #app-root, #root, #app, #output, #demo { margin-bottom: 12px; }
  </style>
</head>
<body>
  <div id="app-root"></div>
  <div id="root"></div>
  <div id="app"></div>
  <div id="output"></div>
  <div id="demo"></div>
  <script>
    (function() {
      var _origGetById = document.getElementById.bind(document);
      document.getElementById = function(id) {
        var el = _origGetById(id);
        if (!el && id && typeof id === 'string') {
          el = document.createElement('div');
          el.id = id;
          (document.getElementById('app-root') || document.body).appendChild(el);
        }
        return el;
      };

      try {
        ${safeScriptContent}
      } catch (err) {
        console.error('innerHTML JavaScript Execution Error:', err);
        var errBox = document.createElement('div');
        errBox.style = 'color: #ef4444; background: #fee2e2; border: 1px solid #f87171; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 13px; margin: 16px 0;';
        errBox.innerHTML = '<strong>⚠️ JavaScript Error:</strong> ' + err.message;
        document.body.appendChild(errBox);
      }
    })();
  <\/script>
</body>
</html>`;
      }
    }

    const activeTab = this.browserTabs.find((t) => t.id === this.activeBrowserTabId);
    if (activeTab) {
      activeTab.title = this.activeFilePath || 'innerHTML';
      activeTab.url = '/' + (this.activeFilePath || 'preview');
      activeTab.srcdoc = docHtml;
      this.renderChromeTabs();
    }

    if (this.el.previewIframe) {
      this.el.previewIframe.srcdoc = docHtml;
    }
    this.switchWorkbenchPanel('panelPreview', true);
  }

  switchWorkbenchPanel(panelId, skipAutoPreview = false) {
    document.querySelectorAll('.wb-nav-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.panel === panelId);
    });
    document.querySelectorAll('.content-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === panelId);
    });
    if (panelId === 'panelPreview' && !skipAutoPreview) {
      this.generatePreview();
    }
  }

  // --- Thunder Client API Tester Controller ---
  initThunderClient() {
    // Update method color
    this.el.thunderMethod.onchange = () => {
      const m = this.el.thunderMethod.value;
      this.el.thunderMethod.className = `thunder-method-select opt-${m.toLowerCase()}`;
    };

    // Sub tabs (Params, Headers, Body)
    document.querySelectorAll('.thunder-subtab').forEach((tab) => {
      tab.onclick = () => {
        document.querySelectorAll('.thunder-subtab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.thunder-tab-pane').forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        const target = document.getElementById(tab.dataset.sub);
        if (target) target.classList.add('active');
      };
    });

    // Response view tabs (Body, Headers, Raw)
    document.querySelectorAll('.resp-tab').forEach((tab) => {
      tab.onclick = () => {
        document.querySelectorAll('.resp-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.resp-view').forEach((v) => v.classList.remove('active'));
        tab.classList.add('active');
        const target = document.getElementById(tab.dataset.view);
        if (target) target.classList.add('active');
      };
    });

    // Add Param row
    this.el.btnAddParamRow.onclick = () => {
      this.addKvRow(this.el.thunderParamsList, '', '', () => this.syncParamsToUrl());
    };

    // Add Header row
    this.el.btnAddHeaderRow.onclick = () => {
      this.addKvRow(this.el.thunderHeadersList, '', '');
    };

    // Auto-sync params to URL on input
    this.el.thunderParamsList.querySelectorAll('.kv-row').forEach((row) => {
      row.querySelectorAll('input').forEach((inp) => {
        inp.oninput = () => this.syncParamsToUrl();
      });
    });

    // Prettify JSON Button
    this.el.btnFormatJson.onclick = () => {
      const raw = this.el.thunderBodyText.value.trim();
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        this.el.thunderBodyText.value = JSON.stringify(parsed, null, 2);
      } catch (err) {
        alert('Invalid JSON syntax: ' + err.message);
      }
    };

    // Send Button
    this.el.btnThunderSend.onclick = () => this.sendThunderRequest();
  }

  addKvRow(container, key = '', val = '', onChange) {
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = `
      <input type="text" class="kv-key" placeholder="Key" value="${key}" />
      <input type="text" class="kv-val" placeholder="Value" value="${val}" />
      <button class="kv-del" title="Remove">×</button>
    `;
    row.querySelector('.kv-del').onclick = () => {
      row.remove();
      if (onChange) onChange();
    };
    if (onChange) {
      row.querySelectorAll('input').forEach((i) => (i.oninput = onChange));
    }
    container.appendChild(row);
  }

  syncParamsToUrl() {
    try {
      const urlStr = this.el.thunderUrl.value.trim();
      if (!urlStr) return;
      const devPort = this.activeServerPort || '3001';
      const url = new URL(urlStr.startsWith('http') ? urlStr : `http://localhost:${devPort}${urlStr.startsWith('/') ? urlStr : '/' + urlStr}`);
      const params = new URLSearchParams();

      this.el.thunderParamsList.querySelectorAll('.kv-row').forEach((row) => {
        const k = row.querySelector('.kv-key').value.trim();
        const v = row.querySelector('.kv-val').value.trim();
        if (k) params.set(k, v);
      });

      url.search = params.toString();
      this.el.thunderUrl.value = url.toString();
    } catch {}
  }

  async sendThunderRequest() {
    const method = this.el.thunderMethod.value;
    let url = this.el.thunderUrl.value.trim();
    if (!url) {
      alert('Please enter a request URL');
      return;
    }

    const devPort = this.activeServerPort || '3001';

    if (url.startsWith('/')) {
      url = `http://localhost:${devPort}${url}`;
    } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `http://${url}`;
    }

    // Port 3000 Reservation Guard: Prevent targeting the platform host port 3000
    try {
      const parsed = new URL(url);
      const isLocalhost = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(parsed.hostname);
      const portNum = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
      if (isLocalhost && portNum === '3000') {
        this.el.respStatusBadge.className = 'resp-status status-5xx';
        this.el.respStatusBadge.textContent = 'Port 3000 Reserved';
        this.el.respTime.textContent = '0 ms';
        this.el.respSize.textContent = '0 B';
        this.el.respBodyPre.innerHTML = `⚠️ <strong>Port 3000 is Strictly Reserved for the Code Editor Web Platform</strong>\n\n` +
          `Port 3000 is occupied by this web application itself. Directing API tests to port 3000 will conflict with the IDE.\n\n` +
          `👉 <strong>How to resolve:</strong>\n` +
          `   1. In your code, update your port definition to:\n` +
          `      <code>const PORT = process.env.PORT || 3001;</code> (or 3002, 4000, 5000, 8080)\n` +
          `   2. Click "Run Server" (▶) to launch your server on an available port.\n` +
          `   3. Update your URL to test port 3001 or click a discovered route above.\n`;
        this.el.respRawPre.textContent = 'Error: Port 3000 is strictly reserved for the Code Editor web platform';
        this.el.respHeadersPre.textContent = '{\n  "error": "Reserved Port 3000"\n}';
        return;
      }
    } catch {}

    // Collect headers
    const headers = {};
    this.el.thunderHeadersList.querySelectorAll('.kv-row').forEach((row) => {
      const k = row.querySelector('.kv-key').value.trim();
      const v = row.querySelector('.kv-val').value.trim();
      if (k) headers[k] = v;
    });

    // Collect body
    let body = null;
    const rawBody = this.el.thunderBodyText.value.trim();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }

    this.el.btnThunderSend.disabled = true;
    this.el.thunderSendText.textContent = 'Sending...';
    this.el.respStatusBadge.className = 'resp-status status-idle';
    this.el.respStatusBadge.textContent = 'Loading...';
    this.el.respTime.textContent = '...';
    this.el.respSize.textContent = '...';

    const startTime = Date.now();

    try {
      const res = await fetch('/api/v1/proxy-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Target-Port': String(devPort),
        },
        body: JSON.stringify({ url, method, headers, body }),
      });

      const rawText = await res.text();
      let data = null;
      let isJson = false;

      try {
        data = JSON.parse(rawText);
        isJson = true;
      } catch {
        // Response was not JSON (e.g. HTML error page or raw plain text)
        const isHtml = rawText.trim().startsWith('<!DOCTYPE') || rawText.trim().startsWith('<html');
        data = {
          status: res.status,
          statusText: res.statusText || (res.ok ? 'OK' : 'Error'),
          message: isHtml
            ? `Server returned an HTML response (${res.status} ${res.statusText || 'Error'})`
            : rawText,
          raw: rawText,
          isHtml,
        };
      }

      const durationMs = (data && data.durationMs) ? data.durationMs : (Date.now() - startTime);

      if (!res.ok) {
        this.el.respStatusBadge.className = 'resp-status status-5xx';
        this.el.respStatusBadge.textContent = `Error ${res.status}`;
        this.el.respTime.textContent = `${durationMs} ms`;
        const sizeBytes = rawText.length;
        this.el.respSize.textContent = sizeBytes > 1024 ? `${(sizeBytes / 1024).toFixed(1)} KB` : `${sizeBytes} B`;

        if (data && data.code === 'ECONNREFUSED') {
          const targetP = data.targetPort || devPort;
          this.el.respBodyPre.innerHTML = `⚠️ <strong>Server Not Listening on Port ${targetP}</strong>\n\n` +
            `Your Node.js server is not running yet or hasn't started listening.\n\n` +
            `👉 <strong>How to run it:</strong>\n` +
            `   1. Click "Run Server" (▶) in the top bar or inside this panel.\n` +
            `   2. Check Terminal tab for: "Server listening on port..."\n` +
            `   3. Once active, click "Send Request" to test your API.\n\n` +
            (isJson ? JSON.stringify(data, null, 2) : rawText);
        } else if (data && data.isHtml) {
          if (this.el.thunderPreviewIframe) {
            this.el.thunderPreviewIframe.srcdoc = rawText;
          }
          if (this.el.previewIframe) {
            this.el.previewIframe.srcdoc = rawText;
          }
          this.el.respBodyPre.innerHTML = `⚠️ <strong>HTML Response Returned (${res.status} ${res.statusText || ''})</strong>\n\n` +
            `The server responded with HTML rather than JSON. Check the "Preview" tab to view rendered page.\n\n` +
            `<strong>Preview:</strong>\n` +
            rawText.slice(0, 500).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        } else {
          this.el.respBodyPre.textContent = isJson ? JSON.stringify(data, null, 2) : String(rawText);
        }
        this.el.respRawPre.textContent = rawText;
        this.el.respHeadersPre.textContent = JSON.stringify(data.headers || {}, null, 2);
        return;
      }

      // Display status code badge
      const status = data.status || 200;
      let statusClass = 'status-2xx';
      if (status >= 500) statusClass = 'status-5xx';
      else if (status >= 400) statusClass = 'status-4xx';
      else if (status >= 300) statusClass = 'status-3xx';

      this.el.respStatusBadge.className = `resp-status ${statusClass}`;
      this.el.respStatusBadge.textContent = `${status} ${data.statusText || 'OK'}`;
      this.el.respTime.textContent = `${durationMs} ms`;

      const bytes = data.sizeBytes !== undefined ? data.sizeBytes : rawText.length;
      this.el.respSize.textContent = bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;

      // Display formatted JSON body, HTML preview, or raw text
      const bodyContent = data.data !== undefined ? data.data : rawText;
      const bodyTextStr = typeof bodyContent === 'string' ? bodyContent : JSON.stringify(bodyContent);
      const isHtml =
        bodyTextStr.trim().startsWith('<!DOCTYPE') ||
        bodyTextStr.trim().startsWith('<html') ||
        bodyTextStr.trim().startsWith('<!--') ||
        (data.headers && String(data.headers['content-type'] || '').includes('text/html')) ||
        (/<[a-z][\s\S]*>/i.test(bodyTextStr) && (bodyTextStr.includes('<form') || bodyTextStr.includes('<div') || bodyTextStr.includes('<body') || bodyTextStr.includes('<head')));

      if (this.el.thunderPreviewIframe) {
        this.el.thunderPreviewIframe.srcdoc = bodyTextStr;
      }
      if (this.el.previewIframe) {
        this.el.previewIframe.srcdoc = bodyTextStr;
      }

      if (isHtml) {
        // Auto-switch to Preview tab in Thunder Client response
        document.querySelectorAll('.resp-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.resp-view').forEach((v) => v.classList.remove('active'));
        const pTab = document.getElementById('tabRespPreview');
        const pView = document.getElementById('respPreview');
        if (pTab) pTab.classList.add('active');
        if (pView) pView.classList.add('active');
      } else {
        // If JSON or plain text, auto-activate Body tab
        document.querySelectorAll('.resp-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.resp-view').forEach((v) => v.classList.remove('active'));
        const bTab = document.getElementById('tabRespBody');
        const bView = document.getElementById('respBody');
        if (bTab) bTab.classList.add('active');
        if (bView) bView.classList.add('active');
      }

      if (data.isJson || (data.data && typeof data.data === 'object')) {
        const displayData = data.data !== undefined ? data.data : data;
        this.el.respBodyPre.textContent = JSON.stringify(displayData, null, 2);
        this.el.respRawPre.textContent = JSON.stringify(displayData);
      } else {
        this.el.respBodyPre.textContent = String(bodyContent);
        this.el.respRawPre.textContent = String(bodyContent);
      }

      // Display response headers
      this.el.respHeadersPre.textContent = JSON.stringify(data.headers || {}, null, 2);
    } catch (err) {
      this.el.respStatusBadge.className = 'resp-status status-5xx';
      this.el.respStatusBadge.textContent = 'Network Error';
      this.el.respBodyPre.textContent = `Error: ${err.message}\n\nPlease ensure your Node.js application is running and the port is reachable.`;
      this.el.respRawPre.textContent = `Error: ${err.message}`;
    } finally {
      this.el.btnThunderSend.disabled = false;
      this.el.thunderSendText.textContent = 'Send Request';
    }
  }

  initEvents() {
    this.el.btnRun.onclick = () => this.executeCode();
    this.el.btnStop.onclick = () => this.stopCode();
    this.el.btnNewFileHeader.onclick = () => this.openCreateModal();
    this.el.btnNewTab.onclick = () => this.openCreateModal();
    this.el.btnNewFileSidebar.onclick = () => this.openCreateModal();

    if (this.el.alertBannerClose) {
      this.el.alertBannerClose.onclick = () => this.dismissSystemAlert();
    }

    // Font size changer events
    this.el.btnFontDec.onclick = () => this.applyFontSize(this.fontSize - 1);
    this.el.btnFontInc.onclick = () => this.applyFontSize(this.fontSize + 1);
    this.el.fontSizeSelect.onchange = () => {
      this.applyFontSize(parseInt(this.el.fontSizeSelect.value, 10));
    };

    // Toggle explorer
    this.el.btnToggleExplorer.onclick = () => {
      this.isExplorerOpen = !this.isExplorerOpen;
      this.el.fileExplorerDrawer.classList.toggle('collapsed', !this.isExplorerOpen);
      this.el.btnToggleExplorer.classList.toggle('active', this.isExplorerOpen);
      if (this.editor) this.editor.layout();
    };

    // Open Thunder Client from side bar
    this.el.btnOpenThunderSide.onclick = () => {
      this.switchWorkbenchPanel('panelThunder');
    };

    // Reset template
    this.el.btnClearStorage.onclick = () => {
      if (confirm('Reset files to default Node.js starter template?')) {
        this.files.clear();
        this.openTabs = ['index.js'];
        this.initFiles();
        this.switchActiveFile('index.js');
      }
    };

    this.el.btnClearConsole.onclick = () => this.clearConsole();

    // Workbench tabs
    document.querySelectorAll('.wb-nav-tab').forEach((tab) => {
      tab.onclick = () => this.switchWorkbenchPanel(tab.dataset.panel);
    });

    // HTML Preview toolbar buttons
    this.el.btnRefreshPreview.onclick = () => this.generatePreview();
    this.el.btnInjectInnerHtml.onclick = () => this.injectCurrentCodeToInnerHtml();

    // Modal events
    this.el.btnModalCancel.onclick = () => this.closeModal();
    this.el.btnModalConfirm.onclick = () => this.confirmModalAction();
    this.el.modalInput.onkeydown = (e) => {
      if (e.key === 'Enter') this.confirmModalAction();
      else if (e.key === 'Escape') this.closeModal();
    };

    // Global keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.executeCode();
      } else if (e.key === 'Escape' && this.isExecuting) {
        this.stopCode();
      }
    });

    // Splitter Dragging
    let isDragging = false;
    this.el.mainVerticalSplitter.onmousedown = () => {
      isDragging = true;
      this.el.mainVerticalSplitter.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
    };

    window.onmousemove = (e) => {
      if (!isDragging) return;
      const offset = (this.isExplorerOpen ? 220 : 0) + 48;
      const newLeftWidth = e.clientX - offset;
      const totalWidth = window.innerWidth - offset;
      if (newLeftWidth > 200 && totalWidth - newLeftWidth > 220) {
        this.el.editorPane.style.flex = `0 0 ${newLeftWidth}px`;
        if (this.editor) this.editor.layout();
      }
    };

    window.onmouseup = () => {
      if (isDragging) {
        isDragging = false;
        this.el.mainVerticalSplitter.classList.remove('dragging');
        document.body.style.cursor = 'default';
        if (this.editor) this.editor.layout();
      }
    };

    // Preview iframe error and console listener
    window.addEventListener('message', (event) => {
      if (!event.data) return;
      if (event.data.type === 'preview_error') {
        const lineInfo = event.data.line ? ` (Line ${event.data.line}:${event.data.col || 0})` : '';
        this.appendConsole(`[Preview Exception]${lineInfo}: ${event.data.message}\n`, 'log-stderr');
      } else if (event.data.type === 'preview_console') {
        const cls = event.data.level === 'stderr' ? 'log-stderr' : 'log-stdout';
        this.appendConsole(`[Preview] ${event.data.data}\n`, cls);
      }
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.compilerApp = new CodeEditorApp();
});
