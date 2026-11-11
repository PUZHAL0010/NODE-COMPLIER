/**
 * Strict File System and Path Security Validator
 * Validates, normalizes, and verifies that all files reside safely within the project root.
 */

import path from 'path';
import { ProjectFile } from '../../shared/types';
import {
  ALLOWED_FILE_EXTENSIONS,
  FORBIDDEN_FILE_EXTENSIONS,
  SYSTEM_LIMITS,
} from '../utils/limits';

export class FileValidationError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code = 'FILE_VALIDATION_ERROR', details?: Record<string, unknown>) {
    super(message);
    this.name = 'FileValidationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Windows device names that must never be created as filenames
 */
const WINDOWS_DEVICE_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/**
 * Normalize and strictly validate a relative file path.
 * Returns the canonical forward-slash separated path relative to project root.
 */
export function normalizeAndValidatePath(rawPath: string): string {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    throw new FileValidationError('File path must be a non-empty string.', 'EMPTY_PATH');
  }

  // 1. Check for null bytes
  if (rawPath.includes('\0')) {
    throw new FileValidationError(
      `Path contains forbidden null byte: "${rawPath}"`,
      'NULL_BYTE_DETECTED'
    );
  }

  // 2. Check path length
  if (rawPath.length > SYSTEM_LIMITS.MAX_PATH_LENGTH) {
    throw new FileValidationError(
      `Path length (${rawPath.length}) exceeds maximum allowed of ${SYSTEM_LIMITS.MAX_PATH_LENGTH} characters.`,
      'PATH_TOO_LONG'
    );
  }

  // 3. Reject backslashes explicitly or convert to slash for check
  if (rawPath.includes('\\')) {
    throw new FileValidationError(
      `Path contains invalid separator '\\'. Use forward slashes: "${rawPath}"`,
      'INVALID_PATH_SEPARATOR'
    );
  }

  // 4. Reject absolute paths (starting with / or driving letter e.g. C:)
  if (rawPath.startsWith('/') || /^[a-zA-Z]:/.test(rawPath)) {
    throw new FileValidationError(
      `Absolute paths are strictly forbidden: "${rawPath}"`,
      'ABSOLUTE_PATH_FORBIDDEN'
    );
  }

  // 5. Normalize path using POSIX rules
  const normalized = path.posix.normalize(rawPath);

  // 6. Check for directory traversal escapes
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new FileValidationError(
      `Directory traversal detected in path: "${rawPath}"`,
      'PATH_TRAVERSAL_DETECTED'
    );
  }

  // 7. Check directory depth
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length > SYSTEM_LIMITS.MAX_DIRECTORY_DEPTH) {
    throw new FileValidationError(
      `Directory nesting depth (${segments.length}) exceeds maximum limit (${SYSTEM_LIMITS.MAX_DIRECTORY_DEPTH}).`,
      'MAX_DEPTH_EXCEEDED'
    );
  }

  // 8. Check for reserved Windows device names and hidden/dangerous prefixes
  for (const seg of segments) {
    const baseName = seg.split('.')[0].toUpperCase();
    if (WINDOWS_DEVICE_NAMES.has(baseName)) {
      throw new FileValidationError(
        `File name contains reserved system device name: "${seg}"`,
        'RESERVED_DEVICE_NAME'
      );
    }
    if (seg === '.' || seg === '..') {
      throw new FileValidationError(
        `Invalid path segment "${seg}" in path "${rawPath}"`,
        'INVALID_SEGMENT'
      );
    }
  }

  // 9. Validate file extension
  const ext = path.posix.extname(normalized).toLowerCase();
  if (FORBIDDEN_FILE_EXTENSIONS.has(ext)) {
    throw new FileValidationError(
      `File extension "${ext}" is forbidden for security reasons.`,
      'FORBIDDEN_EXTENSION'
    );
  }

  if (!ALLOWED_FILE_EXTENSIONS.has(ext)) {
    throw new FileValidationError(
      `File extension "${ext}" is not supported. Allowed extensions: ${Array.from(
        ALLOWED_FILE_EXTENSIONS
      ).join(', ')}`,
      'UNSUPPORTED_EXTENSION'
    );
  }

  return normalized;
}

/**
 * Validate an entire project payload: file count, individual sizes, total size, uniqueness, and entryFile existence.
 */
export function validateProjectFiles(files: ProjectFile[], entryFile: string): ProjectFile[] {
  if (!Array.isArray(files) || files.length === 0) {
    throw new FileValidationError('Project must contain at least one file.', 'EMPTY_PROJECT');
  }

  if (files.length > SYSTEM_LIMITS.MAX_PROJECT_FILES) {
    throw new FileValidationError(
      `Project contains ${files.length} files, exceeding limit of ${SYSTEM_LIMITS.MAX_PROJECT_FILES}.`,
      'TOO_MANY_FILES'
    );
  }

  const normalizedFiles: ProjectFile[] = [];
  const pathSet = new Set<string>();
  let totalProjectBytes = 0;

  for (const file of files) {
    if (!file || typeof file.path !== 'string') {
      throw new FileValidationError('Each file object must have a valid path.', 'INVALID_FILE_OBJECT');
    }

    const canonicalPath = normalizeAndValidatePath(file.path);

    if (pathSet.has(canonicalPath)) {
      throw new FileValidationError(
        `Duplicate file path found in project: "${canonicalPath}"`,
        'DUPLICATE_FILE_PATH'
      );
    }
    pathSet.add(canonicalPath);

    const content = typeof file.content === 'string' ? file.content : '';
    const contentBytes = Buffer.byteLength(content, 'utf8');

    if (contentBytes > SYSTEM_LIMITS.MAX_INDIVIDUAL_FILE_BYTES) {
      throw new FileValidationError(
        `File "${canonicalPath}" size (${contentBytes} bytes) exceeds limit of ${SYSTEM_LIMITS.MAX_INDIVIDUAL_FILE_BYTES} bytes.`,
        'FILE_TOO_LARGE'
      );
    }

    totalProjectBytes += contentBytes;
    if (totalProjectBytes > SYSTEM_LIMITS.MAX_TOTAL_PROJECT_BYTES) {
      throw new FileValidationError(
        `Total project size (${totalProjectBytes} bytes) exceeds limit of ${SYSTEM_LIMITS.MAX_TOTAL_PROJECT_BYTES} bytes.`,
        'PROJECT_TOO_LARGE'
      );
    }

    normalizedFiles.push({
      path: canonicalPath,
      content,
      type: file.type || path.posix.extname(canonicalPath).slice(1),
    });
  }

  // Validate entry file
  const normalizedEntry = normalizeAndValidatePath(entryFile);
  if (!pathSet.has(normalizedEntry)) {
    throw new FileValidationError(
      `Entry file "${normalizedEntry}" was not found among the project files.`,
      'ENTRY_FILE_NOT_FOUND'
    );
  }

  return normalizedFiles;
}
