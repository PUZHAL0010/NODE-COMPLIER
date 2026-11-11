/**
 * Hardened SSRF Defense Engine
 * Prevents Server-Side Request Forgery by validating URLs, resolving DNS asynchronously,
 * blocking loopback, link-local, private networks (RFC 1918), cloud metadata endpoints,
 * and IPv4-mapped IPv6 addresses. Protects platform port 3000.
 */

import dns from 'dns';
import net from 'net';
import { RESERVED_PLATFORM_PORT } from '../utils/portManager';
import { logger } from '../utils/logger';

export interface SsrfValidationResult {
  valid: boolean;
  safeUrl: string;
  resolvedIp?: string;
  error?: string;
  code?: string;
}

export interface SsrfGuardOptions {
  allowLocalhostDevServers?: boolean;
  allowedDeveloperPorts?: number[];
  maxRedirects?: number;
  timeoutMs?: number;
}

const CLOUD_METADATA_HOSTS = new Set([
  '169.254.169.254',
  '100.100.100.200',
  'metadata.google.internal',
  'metadata.google',
  'metadata',
  'instance-data',
]);

/**
 * Checks whether an IPv4 address falls within private, link-local, or reserved ranges.
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) {
    return true; // Malformed is considered unsafe
  }

  const [a, b] = parts;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;

  // 10.0.0.0/8 (Private)
  if (a === 10) return true;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;

  // 169.254.0.0/16 (Link-local / Cloud metadata AWS/GCP/Azure)
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12 (Private: 172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;

  // 100.64.0.0/10 (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (a === 192 && b === 0 && parts[2] === 0) return true;

  // 198.18.0.0/15 (Network benchmark tests)
  if (a === 198 && (b === 18 || b === 19)) return true;

  // 224.0.0.0/4 (Multicast)
  if (a >= 224 && a <= 239) return true;

  // 240.0.0.0/4 (Reserved for future use / Broadcast)
  if (a >= 240) return true;

  return false;
}

/**
 * Checks whether an IPv6 address falls within private, loopback, or link-local ranges.
 */
export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // Loopback (::1)
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;

  // Unspecified (::)
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;

  // Unique local addresses (fc00::/7 -> fc00:: to fdff::)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  // Link-local addresses (fe80::/10)
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  if (normalized.startsWith('::ffff:')) {
    const v4Part = normalized.replace('::ffff:', '');
    if (net.isIPv4(v4Part)) {
      return isPrivateIPv4(v4Part);
    }
  }

  return false;
}

/**
 * Asynchronously validates target URL against SSRF threats, resolves DNS,
 * and checks IP address safety.
 */
export async function validateSsrfTarget(
  targetUrl: string,
  options: SsrfGuardOptions = { allowLocalhostDevServers: true }
): Promise<SsrfValidationResult> {
  if (!targetUrl || typeof targetUrl !== 'string') {
    return { valid: false, safeUrl: '', error: 'URL is required', code: 'INVALID_URL' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl.trim());
  } catch {
    return {
      valid: false,
      safeUrl: '',
      error: 'Invalid URL syntax. Must be a valid absolute HTTP or HTTPS URL.',
      code: 'INVALID_URL_SYNTAX',
    };
  }

  const protocol = parsedUrl.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return {
      valid: false,
      safeUrl: '',
      error: `Forbidden protocol "${parsedUrl.protocol}". Only http:// and https:// are permitted.`,
      code: 'FORBIDDEN_PROTOCOL',
    };
  }

  const port = parsedUrl.port
    ? parseInt(parsedUrl.port, 10)
    : protocol === 'https:'
    ? 443
    : 80;

  if (isNaN(port) || port < 1 || port > 65535) {
    return {
      valid: false,
      safeUrl: '',
      error: `Port "${parsedUrl.port}" is out of allowable range (1 - 65535).`,
      code: 'INVALID_PORT',
    };
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // 1. Strict Cloud Metadata Hostname Check
  if (CLOUD_METADATA_HOSTS.has(hostname) || hostname.endsWith('.internal')) {
    logger.warn({ hostname, targetUrl }, 'Blocked direct cloud metadata hostname lookup');
    return {
      valid: false,
      safeUrl: '',
      error: 'Access to cloud metadata endpoints is strictly forbidden under security policy.',
      code: 'METADATA_BLOCKED',
    };
  }

  // 2. Strict Platform Port 3000 Check for Localhost
  const isLocalhostHost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1';

  if (isLocalhostHost && port === RESERVED_PLATFORM_PORT) {
    return {
      valid: false,
      safeUrl: '',
      error: 'Port 3000 is reserved for the Code Editor web platform. Please run your API on port 3001, 3002, 4000, 5000, 8080.',
      code: 'RESERVED_PORT_3000',
    };
  }

  // 3. If target is a direct IP address literal, validate immediately
  if (net.isIPv4(hostname)) {
    if (hostname === '127.0.0.1') {
      if (options.allowLocalhostDevServers && port !== RESERVED_PLATFORM_PORT) {
        return { valid: true, safeUrl: parsedUrl.toString(), resolvedIp: '127.0.0.1' };
      }
      return { valid: false, safeUrl: '', error: 'Localhost loopback address is blocked.', code: 'LOOPBACK_BLOCKED' };
    }

    if (isPrivateIPv4(hostname)) {
      logger.warn({ ip: hostname, targetUrl }, 'Blocked private IPv4 destination');
      return {
        valid: false,
        safeUrl: '',
        error: `Access to private IP range (${hostname}) is blocked under security policy.`,
        code: 'PRIVATE_IP_BLOCKED',
      };
    }

    return { valid: true, safeUrl: parsedUrl.toString(), resolvedIp: hostname };
  }

  if (net.isIPv6(hostname)) {
    if (hostname === '::1') {
      if (options.allowLocalhostDevServers && port !== RESERVED_PLATFORM_PORT) {
        return { valid: true, safeUrl: parsedUrl.toString(), resolvedIp: '::1' };
      }
      return { valid: false, safeUrl: '', error: 'IPv6 loopback address is blocked.', code: 'LOOPBACK_BLOCKED' };
    }

    if (isPrivateIPv6(hostname)) {
      return {
        valid: false,
        safeUrl: '',
        error: `Access to private IPv6 range (${hostname}) is blocked.`,
        code: 'PRIVATE_IP_BLOCKED',
      };
    }

    return { valid: true, safeUrl: parsedUrl.toString(), resolvedIp: hostname };
  }

  // 4. Localhost hostname alias resolution for developer sandboxes
  if (hostname === 'localhost') {
    if (options.allowLocalhostDevServers && port !== RESERVED_PLATFORM_PORT) {
      return { valid: true, safeUrl: parsedUrl.toString(), resolvedIp: '127.0.0.1' };
    }
    return { valid: false, safeUrl: '', error: 'Localhost access is blocked.', code: 'LOOPBACK_BLOCKED' };
  }

  // 5. Asynchronous DNS Resolution & Rebinding Prevention
  try {
    const lookupRecords = await dns.promises.lookup(hostname, { all: true });

    if (!lookupRecords || lookupRecords.length === 0) {
      return {
        valid: false,
        safeUrl: '',
        error: `Could not resolve hostname "${hostname}".`,
        code: 'DNS_RESOLUTION_FAILED',
      };
    }

    for (const record of lookupRecords) {
      const { address, family } = record;

      if (family === 4) {
        if (isPrivateIPv4(address)) {
          logger.warn({ hostname, resolvedIp: address }, 'DNS resolved to private IPv4 — blocked');
          return {
            valid: false,
            safeUrl: '',
            error: `Hostname "${hostname}" resolved to prohibited private IP address (${address}).`,
            code: 'DNS_REBINDING_BLOCKED',
          };
        }
      } else if (family === 6) {
        if (isPrivateIPv6(address)) {
          logger.warn({ hostname, resolvedIp: address }, 'DNS resolved to private IPv6 — blocked');
          return {
            valid: false,
            safeUrl: '',
            error: `Hostname "${hostname}" resolved to prohibited private IPv6 address (${address}).`,
            code: 'DNS_REBINDING_BLOCKED',
          };
        }
      }
    }

    return {
      valid: true,
      safeUrl: parsedUrl.toString(),
      resolvedIp: lookupRecords[0].address,
    };
  } catch (err: any) {
    logger.warn({ hostname, err: err.message }, 'DNS lookup error during SSRF verification');
    return {
      valid: false,
      safeUrl: '',
      error: `DNS resolution failed for hostname "${hostname}": ${err.message}`,
      code: 'DNS_RESOLUTION_FAILED',
    };
  }
}
