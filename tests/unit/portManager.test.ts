/**
 * Unit Tests for Port Management & Conflict Resolution Utility
 */

import net from 'net';
import {
  isPortAvailable,
  findAvailablePort,
  ensurePortAvailable,
  RESERVED_PLATFORM_PORT,
} from '../../server/utils/portManager';

describe('Port Manager & Conflict Resolution Engine', () => {
  it('strictly protects reserved platform port 3000', async () => {
    const is3000Available = await isPortAvailable(RESERVED_PLATFORM_PORT);
    expect(is3000Available).toBe(false);
  });

  it('never returns reserved port 3000 when finding available ports', async () => {
    const port = await findAvailablePort(3000, 3050);
    expect(port).not.toBe(3000);
    expect(port).toBeGreaterThanOrEqual(3001);
    expect(port).toBeLessThanOrEqual(3050);
  });

  it('detects when a test port is in use and when it is free', async () => {
    const testPort = 3125;

    // Initially free
    const initiallyAvailable = await isPortAvailable(testPort);
    expect(typeof initiallyAvailable).toBe('boolean');

    // Create a temporary server on testPort
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.listen(testPort, '0.0.0.0', () => resolve());
      server.on('error', reject);
    });

    try {
      // Now it must be unavailable
      const availableWhileListening = await isPortAvailable(testPort);
      expect(availableWhileListening).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // Now it should be available again
    const availableAfterClose = await isPortAvailable(testPort);
    expect(availableAfterClose).toBe(true);
  });

  it('ensures port availability and returns a valid port number', async () => {
    const port = await ensurePortAvailable(3001);
    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThanOrEqual(3001);
    expect(port).not.toBe(3000);
  });

  it('handles consecutive ensurePortAvailable calls idempotently without throwing', async () => {
    const port1 = await ensurePortAvailable(3001);
    const port2 = await ensurePortAvailable(3001);
    expect(port1).toBeGreaterThanOrEqual(3001);
    expect(port2).toBeGreaterThanOrEqual(3001);
  });
});
