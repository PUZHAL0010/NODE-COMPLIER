import {
  isPrivateIPv4,
  isPrivateIPv6,
  validateSsrfTarget,
} from '../../server/security/ssrfGuard';

describe('SSRF Guard & Network Isolation Unit Tests', () => {
  describe('isPrivateIPv4', () => {
    it('should identify loopback 127.0.0.1 as private/restricted', () => {
      expect(isPrivateIPv4('127.0.0.1')).toBe(true);
      expect(isPrivateIPv4('127.0.0.2')).toBe(true);
    });

    it('should identify RFC 1918 private ranges as private', () => {
      expect(isPrivateIPv4('10.0.0.1')).toBe(true);
      expect(isPrivateIPv4('10.255.255.255')).toBe(true);
      expect(isPrivateIPv4('172.16.0.1')).toBe(true);
      expect(isPrivateIPv4('172.31.255.255')).toBe(true);
      expect(isPrivateIPv4('192.168.1.1')).toBe(true);
      expect(isPrivateIPv4('192.168.0.254')).toBe(true);
    });

    it('should identify link-local and cloud metadata 169.254.169.254 as private', () => {
      expect(isPrivateIPv4('169.254.169.254')).toBe(true);
      expect(isPrivateIPv4('169.254.1.1')).toBe(true);
    });

    it('should identify public IP addresses as non-private', () => {
      expect(isPrivateIPv4('8.8.8.8')).toBe(false);
      expect(isPrivateIPv4('1.1.1.1')).toBe(false);
      expect(isPrivateIPv4('104.26.10.228')).toBe(false);
    });

    it('should treat malformed IPs as private/unsafe', () => {
      expect(isPrivateIPv4('999.999.999.999')).toBe(true);
      expect(isPrivateIPv4('not-an-ip')).toBe(true);
    });
  });

  describe('isPrivateIPv6', () => {
    it('should identify ::1 loopback as private', () => {
      expect(isPrivateIPv6('::1')).toBe(true);
      expect(isPrivateIPv6('0:0:0:0:0:0:0:1')).toBe(true);
    });

    it('should identify unique local and link-local IPv6 as private', () => {
      expect(isPrivateIPv6('fc00::1')).toBe(true);
      expect(isPrivateIPv6('fd12:3456::1')).toBe(true);
      expect(isPrivateIPv6('fe80::1')).toBe(true);
    });

    it('should identify IPv4-mapped IPv6 for private IPv4 as private', () => {
      expect(isPrivateIPv6('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateIPv6('::ffff:10.0.0.1')).toBe(true);
      expect(isPrivateIPv6('::ffff:169.254.169.254')).toBe(true);
    });

    it('should identify public IPv4-mapped IPv6 as non-private', () => {
      expect(isPrivateIPv6('::ffff:8.8.8.8')).toBe(false);
    });
  });

  describe('validateSsrfTarget', () => {
    it('should block AWS/GCP cloud metadata IP 169.254.169.254', async () => {
      const result = await validateSsrfTarget('http://169.254.169.254/latest/meta-data/');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('METADATA_BLOCKED');
    });

    it('should block GCP internal metadata hostname', async () => {
      const result = await validateSsrfTarget('http://metadata.google.internal/computeMetadata/v1/');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('METADATA_BLOCKED');
    });

    it('should strictly block reserved platform port 3000 on localhost', async () => {
      const result = await validateSsrfTarget('http://localhost:3000/api/v1/jobs');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('RESERVED_PORT_3000');
    });

    it('should strictly block reserved platform port 3000 on 127.0.0.1', async () => {
      const result = await validateSsrfTarget('http://127.0.0.1:3000/api/v1/jobs');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('RESERVED_PORT_3000');
    });

    it('should allow legitimate user server on port 3001, 3002, 5000 on localhost', async () => {
      const result3001 = await validateSsrfTarget('http://localhost:3001/api/users', {
        allowLocalhostDevServers: true,
      });
      expect(result3001.valid).toBe(true);

      const result5000 = await validateSsrfTarget('http://127.0.0.1:5000/api/health', {
        allowLocalhostDevServers: true,
      });
      expect(result5000.valid).toBe(true);
    });

    it('should reject invalid ports like 0 or 70000', async () => {
      const result0 = await validateSsrfTarget('http://localhost:0/test');
      expect(result0.valid).toBe(false);
      expect(result0.code).toBe('INVALID_PORT');

      const resultHuge = await validateSsrfTarget('http://localhost:70000/test');
      expect(resultHuge.valid).toBe(false);
      expect(['INVALID_PORT', 'INVALID_URL_SYNTAX']).toContain(resultHuge.code);
    });

    it('should reject non-http/https protocols like file:// or gopher://', async () => {
      const resultFile = await validateSsrfTarget('file:///etc/passwd');
      expect(resultFile.valid).toBe(false);
      expect(resultFile.code).toBe('FORBIDDEN_PROTOCOL');
    });
  });
});
