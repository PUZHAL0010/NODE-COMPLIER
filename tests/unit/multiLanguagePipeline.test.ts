import {
  detectFileLanguage,
  routeExecutionPipeline,
  LanguageType,
  PipelineType,
} from '../../server/compiler/languageRouter';
import { PreviewService } from '../../server/services/previewService';

describe('Multi-Language Pipeline & Preview Service', () => {
  describe('Language Routing', () => {
    it('detects all supported extensions accurately', () => {
      expect(detectFileLanguage('index.html')).toBe(LanguageType.HTML);
      expect(detectFileLanguage('page.htm')).toBe(LanguageType.HTML);
      expect(detectFileLanguage('styles.css')).toBe(LanguageType.CSS);
      expect(detectFileLanguage('template.ejs')).toBe(LanguageType.EJS);
      expect(detectFileLanguage('Component.jsx')).toBe(LanguageType.JSX);
      expect(detectFileLanguage('server.js')).toBe(LanguageType.JAVASCRIPT);
      expect(detectFileLanguage('module.mjs')).toBe(LanguageType.ESM);
      expect(detectFileLanguage('legacy.cjs')).toBe(LanguageType.COMMONJS);
      expect(detectFileLanguage('app.ts')).toBe(LanguageType.TYPESCRIPT);
      expect(detectFileLanguage('App.tsx')).toBe(LanguageType.TSX);
      expect(detectFileLanguage('data.json')).toBe(LanguageType.JSON);
    });

    it('routes .html and .css files to WEB_PREVIEW pipeline', () => {
      const files = [{ path: 'index.html', content: '<h1>Hello</h1>' }];
      const route = routeExecutionPipeline(files, 'index.html');
      expect(route.pipeline).toBe(PipelineType.WEB_PREVIEW);
      expect(route.isWebPreview).toBe(true);
    });

    it('routes .ejs files to EJS_RENDER pipeline', () => {
      const files = [{ path: 'index.ejs', content: '<h2><%= title %></h2>' }];
      const route = routeExecutionPipeline(files, 'index.ejs');
      expect(route.pipeline).toBe(PipelineType.EJS_RENDER);
      expect(route.isWebPreview).toBe(true);
    });

    it('routes .jsx files to JSX_TRANSFORM pipeline with compilation required', () => {
      const files = [{ path: 'App.jsx', content: 'export default function App() { return <h1>App</h1>; }' }];
      const route = routeExecutionPipeline(files, 'App.jsx');
      expect(route.pipeline).toBe(PipelineType.JSX_TRANSFORM);
      expect(route.requiresCompilation).toBe(true);
    });
  });

  describe('PreviewService', () => {
    it('includes expanded CSP permitting CDN packages, Tailwind, Bootstrap, and FontAwesome', () => {
      const files = [{ path: 'index.html', content: '<html><head></head><body><h1>Test</h1></body></html>' }];
      const bundle = PreviewService.generateBundle(files, 'index.html');
      expect(bundle.csp).toContain('https://cdn.tailwindcss.com');
      expect(bundle.csp).toContain('https://cdnjs.cloudflare.com');
      expect(bundle.csp).toContain('https://unpkg.com');
      expect(bundle.csp).toContain('https://cdn.jsdelivr.net');
      expect(bundle.csp).toContain('https://fonts.googleapis.com');
      expect(bundle.bundledHtml).toContain('Content-Security-Policy');
    });

    it('injects default mounting containers for innerHTML scripts', () => {
      const files = [{ path: 'index.js', content: "document.getElementById('root').innerHTML = '<h1>Injected</h1>';" }];
      const bundle = PreviewService.generateBundle(files, 'index.html');
      expect(bundle.bundledHtml).toContain('id="root"');
      expect(bundle.bundledHtml).toContain('id="app"');
      expect(bundle.bundledHtml).toContain('id="app-root"');
    });

    it('injects in-preview error handling and console bridge', () => {
      const files = [{ path: 'index.html', content: '<html><head></head><body></body></html>' }];
      const bundle = PreviewService.generateBundle(files, 'index.html');
      expect(bundle.bundledHtml).toContain('reportPreviewError');
      expect(bundle.bundledHtml).toContain('window.onerror');
      expect(bundle.bundledHtml).toContain('preview_error');
      expect(bundle.bundledHtml).toContain('preview_console');
    });

    it('renders EJS template in preview when EJS is target', () => {
      const files = [{ path: 'index.ejs', content: '<h1><%= title %></h1>' }];
      const bundle = PreviewService.generateBundle(files, 'index.ejs');
      expect(bundle.bundledHtml).toContain('Node.js Application');
    });
  });
});
