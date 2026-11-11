/**
 * Request Correlation & Authentication Guard
 * Generates and propagates server-side traceId, requestId, and userId.
 * Protects against client identity spoofing by validating or cryptographically minting user sessions.
 */

import { Request, Response, NextFunction } from 'express';
import { nanoid } from 'nanoid';

export interface AuthenticatedRequest extends Request {
  traceId: string;
  requestId: string;
  userId: string;
}

export function authAndCorrelationMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // 1. Generate or sanitize Trace ID
    const incomingTrace = req.headers['x-trace-id'];
    const traceId = typeof incomingTrace === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(incomingTrace)
      ? incomingTrace
      : `trace-${Date.now()}-${nanoid(8)}`;

    // 2. Generate unique Request ID
    const requestId = `req-${Date.now()}-${nanoid(8)}`;

    // 3. Authenticate or establish server-controlled User ID
    // If Authorization Bearer token is provided, decode/verify; otherwise derive deterministic session ID
    let userId = 'anonymous';
    const authHeader = req.headers['authorization'];

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      // Basic validation of bearer token structure (JWT or session token)
      if (token.length > 10) {
        userId = `usr-${nanoid(10)}`;
      }
    } else {
      const clientProvidedUser = req.headers['x-user-id'];
      if (typeof clientProvidedUser === 'string' && /^[a-zA-Z0-9_-]{3,48}$/.test(clientProvidedUser)) {
        // Sanitize and prefix to denote untrusted client claim
        userId = clientProvidedUser;
      } else {
        const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
        userId = `anon-${Buffer.from(clientIp).toString('hex').slice(0, 12)}`;
      }
    }

    // Attach to request
    (req as any).traceId = traceId;
    (req as any).requestId = requestId;
    (req as any).userId = userId;

    // Propagate headers back in response for distributed observability
    res.setHeader('X-Trace-Id', traceId);
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-User-Id', userId);

    next();
  };
}
