import {
  normalizeAndValidatePath,
  validateProjectFiles,
  FileValidationError,
} from '../../server/validation/fileValidation';

describe('File Validation & Path Security', () => {
  describe('normalizeAndValidatePath', () => {
    it('accepts valid relative file paths with allowed extensions', () => {
      expect(normalizeAndValidatePath('index.js')).toBe('index.js');
      expect(normalizeAndValidatePath('App.jsx')).toBe('App.jsx');
      expect(normalizeAndValidatePath('components/Header.jsx')).toBe('components/Header.jsx');
      expect(normalizeAndValidatePath('src/Component.tsx')).toBe('src/Component.tsx');
      expect(normalizeAndValidatePath('src/utils.ts')).toBe('src/utils.ts');
      expect(normalizeAndValidatePath('./config.json')).toBe('config.json');
      expect(normalizeAndValidatePath('components/ui/button.css')).toBe('components/ui/button.css');
      expect(normalizeAndValidatePath('pages/index.html')).toBe('pages/index.html');
      expect(normalizeAndValidatePath('views/index.ejs')).toBe('views/index.ejs');
    });

    it('rejects path traversal attempts with ../', () => {
      expect(() => normalizeAndValidatePath('../secret.txt')).toThrow(FileValidationError);
      expect(() => normalizeAndValidatePath('src/../../etc/passwd')).toThrow(FileValidationError);
      expect(() => normalizeAndValidatePath('../../secret.txt')).toThrow(FileValidationError);
    });

    it('rejects backslashes and Windows path traversal', () => {
      expect(() => normalizeAndValidatePath('..\\..\\Windows\\System32')).toThrow(FileValidationError);
      expect(() => normalizeAndValidatePath('src\\utils.js')).toThrow(FileValidationError);
    });

    it('rejects null byte injection', () => {
      expect(() => normalizeAndValidatePath('index.js\0.png')).toThrow(FileValidationError);
    });

    it('rejects absolute paths', () => {
      expect(() => normalizeAndValidatePath('/etc/passwd')).toThrow(FileValidationError);
      expect(() => normalizeAndValidatePath('C:/Windows/System32/cmd.exe')).toThrow(FileValidationError);
    });

    it('rejects forbidden file extensions', () => {
      expect(() => normalizeAndValidatePath('payload.exe')).toThrow(FileValidationError);
      expect(() => normalizeAndValidatePath('script.sh')).toThrow(FileValidationError);
      expect(() => normalizeAndValidatePath('hack.bat')).toThrow(FileValidationError);
      expect(() => normalizeAndValidatePath('trojan.dll')).toThrow(FileValidationError);
      expect(() => normalizeAndValidatePath('script.ps1')).toThrow(FileValidationError);
    });

    it('rejects Windows reserved device names', () => {
      expect(() => normalizeAndValidatePath('CON.js')).toThrow(FileValidationError);
      expect(() => normalizeAndValidatePath('aux.json')).toThrow(FileValidationError);
      expect(() => normalizeAndValidatePath('NUL.txt')).toThrow(FileValidationError);
    });

    it('rejects excessively deep directory nesting', () => {
      const deepPath = 'a/b/c/d/e/f/g/h/i/j/app.js';
      expect(() => normalizeAndValidatePath(deepPath)).toThrow(FileValidationError);
    });
  });

  describe('validateProjectFiles', () => {
    it('validates a correct multi-file project and checks entryFile', () => {
      const files = [
        { path: 'index.js', content: 'console.log("hello");' },
        { path: 'utils.js', content: 'export const add = (a, b) => a + b;' },
      ];
      const result = validateProjectFiles(files, 'index.js');
      expect(result).toHaveLength(2);
      expect(result[0].path).toBe('index.js');
    });

    it('rejects duplicate file paths in a project', () => {
      const files = [
        { path: 'index.js', content: '1' },
        { path: './index.js', content: '2' },
      ];
      expect(() => validateProjectFiles(files, 'index.js')).toThrow(FileValidationError);
    });

    it('rejects when entryFile is missing from files', () => {
      const files = [{ path: 'utils.js', content: 'export const a = 1;' }];
      expect(() => validateProjectFiles(files, 'index.js')).toThrow(FileValidationError);
    });

    it('rejects project when a file exceeds size limit', () => {
      const hugeContent = 'a'.repeat(2 * 1024 * 1024); // 2 MB
      const files = [{ path: 'index.js', content: hugeContent }];
      expect(() => validateProjectFiles(files, 'index.js')).toThrow(FileValidationError);
    });
  });
});
