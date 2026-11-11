/**
 * Structured Logging Engine
 * Powered by Pino with correlation ID propagation and automated secret redaction
 */

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'secret',
      'redisPassword',
      'token',
      'apiKey',
    ],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

/**
 * Create a child logger bound to a specific trace/job correlation context
 */
export function createJobLogger(jobId: string, traceId?: string) {
  return logger.child({
    jobId,
    traceId: traceId || jobId,
  });
}
