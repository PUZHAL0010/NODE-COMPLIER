/**
 * Zod Schema Definitions for API Gateway
 * Strict structural validation for all client-submitted JSON payloads
 */

import { z } from 'zod';
import { SYSTEM_LIMITS } from '../utils/limits';

export const projectFileSchema = z.object({
  path: z.string().min(1).max(SYSTEM_LIMITS.MAX_PATH_LENGTH),
  content: z.string().max(SYSTEM_LIMITS.MAX_INDIVIDUAL_FILE_BYTES),
  type: z.string().optional(),
});

export const executionOptionsSchema = z.object({
  timeoutMs: z
    .number()
    .int()
    .min(SYSTEM_LIMITS.MIN_TIMEOUT_MS)
    .max(SYSTEM_LIMITS.MAX_TIMEOUT_MS)
    .optional(),
  environment: z.string().max(64).optional(),
  memoryMb: z.number().int().min(64).max(SYSTEM_LIMITS.MAX_MEMORY_MB).optional(),
  cpus: z.number().min(0.1).max(SYSTEM_LIMITS.MAX_CPUS).optional(),
});

export const executionRequestSchema = z.object({
  projectId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/, 'projectId must contain only alphanumeric characters, dashes, and underscores'),
  entryFile: z.string().min(1).max(SYSTEM_LIMITS.MAX_PATH_LENGTH),
  files: z
    .array(projectFileSchema)
    .min(1, 'Project must contain at least one file')
    .max(SYSTEM_LIMITS.MAX_PROJECT_FILES, `Cannot exceed ${SYSTEM_LIMITS.MAX_PROJECT_FILES} files`),
  options: executionOptionsSchema.optional(),
});

export const previewRequestSchema = z.object({
  projectId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/, 'projectId must contain only alphanumeric characters, dashes, and underscores'),
  files: z
    .array(projectFileSchema)
    .min(1, 'Project must contain at least one file')
    .max(SYSTEM_LIMITS.MAX_PROJECT_FILES),
  entryHtml: z.string().optional().default('index.html'),
  activeServerPort: z.union([z.string(), z.number()]).optional(),
});

export const cancelJobSchema = z.object({
  reason: z.string().max(256).optional(),
});

export const proxyRequestSchema = z.object({
  url: z.string({ required_error: 'URL is required and must be a valid string.' }).min(1, 'URL is required and must be a valid string.'),
  method: z
    .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'], {
      errorMap: () => ({
        message: 'Invalid HTTP method. Supported methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.',
      }),
    })
    .default('GET'),
  headers: z.record(z.string()).optional().default({}),
  body: z.any().optional(),
});

export const detectEndpointsSchema = z.object({
  files: z
    .array(projectFileSchema)
    .min(1, 'Project must contain at least one file'),
  entryFile: z.string().optional().default('index.js'),
});

export type ExecutionRequestInput = z.infer<typeof executionRequestSchema>;
export type PreviewRequestInput = z.infer<typeof previewRequestSchema>;
export type ProxyRequestInput = z.infer<typeof proxyRequestSchema>;
export type DetectEndpointsInput = z.infer<typeof detectEndpointsSchema>;
