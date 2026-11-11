import { DistributedRateLimiter } from '../../server/security/distributedRateLimiter';
import { Request, Response } from 'express';

describe('Distributed Rate Limiter Unit Tests', () => {
  it('should allow requests within the window limit', async () => {
    const limiter = new DistributedRateLimiter(); // Uses in-memory fallback
    const middleware = limiter.createMiddleware({
      windowMs: 1000,
      max: 5,
      keyPrefix: 'test-limit',
    });

    let passed = 0;
    const mockNext = () => { passed++; };

    for (let i = 0; i < 5; i++) {
      const mockReq = { ip: '192.168.1.50', headers: {} } as Request;
      const mockRes = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      await middleware(mockReq, mockRes, mockNext);
    }

    expect(passed).toBe(5);
  });

  it('should reject request exceeding max requests with HTTP 429 and Retry-After', async () => {
    const limiter = new DistributedRateLimiter();
    const middleware = limiter.createMiddleware({
      windowMs: 5000,
      max: 3,
      keyPrefix: 'test-burst',
      errorMessage: 'Custom burst limit exceeded',
    });

    const mockNext = jest.fn();
    const mockReq = { ip: '10.0.0.99', headers: {} } as Request;

    // First 3 requests succeed
    for (let i = 0; i < 3; i++) {
      const mockRes = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;
      await middleware(mockReq, mockRes, mockNext);
    }
    expect(mockNext).toHaveBeenCalledTimes(3);

    // 4th request must receive 429
    let capturedStatus: number | null = null;
    let capturedBody: any = null;
    const mockRes4 = {
      setHeader: jest.fn(),
      status: jest.fn().mockImplementation((s: number) => {
        capturedStatus = s;
        return {
          json: (b: any) => { capturedBody = b; },
        };
      }),
    } as unknown as Response;

    await middleware(mockReq, mockRes4, mockNext);
    expect(capturedStatus).toBe(429);
    expect(capturedBody?.error).toBe('Too Many Requests');
    expect(capturedBody?.message).toBe('Custom burst limit exceeded');
    expect(mockRes4.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });

  it('should isolate limits across different IP addresses or users', async () => {
    const limiter = new DistributedRateLimiter();
    const middleware = limiter.createMiddleware({
      windowMs: 5000,
      max: 2,
      keyPrefix: 'test-isolation',
    });

    const mockNext = jest.fn();

    // User A hits limit
    const reqA = { ip: '1.1.1.1', headers: {} } as Request;
    const resA = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    await middleware(reqA, resA, mockNext);
    await middleware(reqA, resA, mockNext);
    expect(mockNext).toHaveBeenCalledTimes(2);

    // User B with distinct IP should still be allowed
    const reqB = { ip: '2.2.2.2', headers: {} } as Request;
    const resB = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    await middleware(reqB, resB, mockNext);
    expect(mockNext).toHaveBeenCalledTimes(3);
  });
});
