/**
 * Port Management & Conflict Resolution Utility
 * Ensures reliable developer server execution by detecting port availability,
 * releasing orphaned processes holding developer ports, and providing dynamic fallback.
 * 
 * NOTE: Port 3000 is strictly reserved for the Code Editor web platform.
 */

import net from 'net';
import { execFileSync, execFile } from 'child_process';
import path from 'path';
import fsSync from 'fs';
import { promisify } from 'util';
import { logger } from './logger';

const execFileAsync = promisify(execFile);

export const RESERVED_PLATFORM_PORT = 3000;
export const DEFAULT_DEV_PORT = 3001;
export const MAX_DEV_PORT = 3099;

/**
 * Check if a specific TCP port is available to bind
 */
export async function isPortAvailable(port: number, host = '0.0.0.0'): Promise<boolean> {
  if (port === RESERVED_PLATFORM_PORT) {
    return false; // Port 3000 is always reserved for the platform gateway
  }

  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        resolve(false);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });

    try {
      server.listen(port, host);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Find the next available TCP port starting from preferredPort
 */
export async function findAvailablePort(
  preferredPort = DEFAULT_DEV_PORT,
  maxPort = MAX_DEV_PORT
): Promise<number> {
  const start = preferredPort === RESERVED_PLATFORM_PORT ? preferredPort + 1 : preferredPort;

  for (let p = start; p <= maxPort; p++) {
    if (p === RESERVED_PLATFORM_PORT) continue;
    if (await isPortAvailable(p)) {
      return p;
    }
  }

  // Fallback to OS-assigned ephemeral port
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '0.0.0.0', () => {
      const addr = s.address();
      const freePort = typeof addr === 'object' && addr ? addr.port : DEFAULT_DEV_PORT;
      s.close(() => resolve(freePort));
    });
    s.on('error', reject);
  });
}

/**
 * Terminate any process currently listening on a specific port (except platform port 3000)
 */
export async function killProcessOnPort(port: number): Promise<boolean> {
  if (port === RESERVED_PLATFORM_PORT) {
    logger.warn({ port }, 'Refusing to kill process on reserved platform port 3000');
    return false;
  }

  try {
    if (process.platform === 'win32') {
      const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
      const netstat = path.join(systemRoot, 'System32', 'netstat.exe');
      const netstatBin = fsSync.existsSync(netstat) ? netstat : 'netstat';

      const output = execFileSync(netstatBin, ['-ano', '-p', 'tcp'], {
        encoding: 'utf8',
        windowsHide: true,
      });

      const lines = output.split(/\r?\n/);
      const pidsToKill = new Set<number>();

      for (const line of lines) {
        const trimmed = line.trim();
        // Match TCP lines: TCP 0.0.0.0:3001 0.0.0.0:0 LISTENING 1234
        if (trimmed.includes('LISTENING') && (trimmed.includes(`:${port} `) || trimmed.includes(`:${port}\t`))) {
          const parts = trimmed.split(/\s+/);
          const pidStr = parts[parts.length - 1];
          const pid = parseInt(pidStr, 10);
          if (pid && pid !== process.pid && pid > 4) {
            pidsToKill.add(pid);
          }
        }
      }

      const taskkill = path.join(systemRoot, 'System32', 'taskkill.exe');
      const taskkillBin = fsSync.existsSync(taskkill) ? taskkill : 'taskkill';

      for (const pid of pidsToKill) {
        try {
          execFileSync(taskkillBin, ['/PID', pid.toString(), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          });
          logger.info({ port, pid }, 'Terminated process holding port on Windows');
        } catch {
          // Process may have already exited
        }
      }

      return pidsToKill.size > 0;
    } else {
      // Linux / Docker container
      let killed = false;

      // 1. Try fuser
      try {
        await execFileAsync('fuser', ['-k', '-9', `${port}/tcp`]);
        killed = true;
      } catch {}

      // 2. Try lsof
      if (!killed) {
        try {
          const { stdout } = await execFileAsync('lsof', ['-ti', `:${port}`]);
          const pids = stdout
            .trim()
            .split('\n')
            .map((s) => parseInt(s.trim(), 10))
            .filter((p) => p && p !== process.pid && p > 1);

          for (const pid of pids) {
            try {
              process.kill(pid, 'SIGKILL');
              killed = true;
            } catch {}
          }
        } catch {}
      }

      if (killed) {
        logger.info({ port }, 'Terminated orphaned process holding port on Linux');
      }
      return killed;
    }
  } catch (err) {
    logger.debug({ port, err }, 'killProcessOnPort encountered non-fatal error');
    return false;
  }
}

/**
 * Ensure a port is available for a new server execution.
 * If preferredPort is in use, attempts to terminate the orphaned process holding it.
 * If preferredPort cannot be freed within 400ms, dynamically falls back to the next free port.
 */
export async function ensurePortAvailable(
  preferredPort = DEFAULT_DEV_PORT,
  maxPort = MAX_DEV_PORT
): Promise<number> {
  const targetPort = preferredPort === RESERVED_PLATFORM_PORT ? DEFAULT_DEV_PORT : preferredPort;

  // 1. Check if preferred port is already free
  if (await isPortAvailable(targetPort)) {
    return targetPort;
  }

  // 2. Attempt to terminate any orphaned background process holding the port
  logger.info({ targetPort }, 'Port is occupied - attempting to release lingering process');
  await killProcessOnPort(targetPort);

  // 3. Wait up to 400ms for socket release
  const checkStart = Date.now();
  while (Date.now() - checkStart < 400) {
    await new Promise((r) => setTimeout(r, 50));
    if (await isPortAvailable(targetPort)) {
      logger.info({ targetPort }, 'Successfully released and reclaimed port');
      return targetPort;
    }
  }

  // 4. If targetPort is still unavailable (external service or system lock), find next available port
  const fallbackPort = await findAvailablePort(targetPort + 1, maxPort);
  logger.warn({ preferredPort: targetPort, fallbackPort }, 'Re-routed developer server to free fallback port');
  return fallbackPort;
}
