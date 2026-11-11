import { CircuitBreaker, CircuitState } from '../../server/utils/circuitBreaker';
import { CircuitBreakerError } from '../../server/utils/errors';

describe('Circuit Breaker Resilience Pattern', () => {
  it('starts in CLOSED state and executes actions successfully', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 50 });
    expect(cb.getState()).toBe(CircuitState.CLOSED);

    const result = await cb.execute(async () => 'success_result');
    expect(result).toBe('success_result');
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });

  it('trips to OPEN after exceeding failure threshold and triggers listener', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 100 });
    let tripNotified = false;

    cb.onTrip((err, state) => {
      tripNotified = true;
      expect(state).toBe(CircuitState.OPEN);
      expect(err.message).toBe('intentional failure');
    });

    // First failure
    await expect(cb.execute(async () => { throw new Error('intentional failure'); })).rejects.toThrow();
    expect(cb.getState()).toBe(CircuitState.CLOSED);

    // Second failure: trips to OPEN
    await expect(cb.execute(async () => { throw new Error('intentional failure'); })).rejects.toThrow();
    expect(cb.getState()).toBe(CircuitState.OPEN);
    expect(tripNotified).toBe(true);

    // Fast-fail in OPEN state without calling action
    let actionExecuted = false;
    await expect(
      cb.execute(async () => {
        actionExecuted = true;
        return 'not_reached';
      })
    ).rejects.toThrow(CircuitBreakerError);

    expect(actionExecuted).toBe(false);
  });

  it('recovers from OPEN to HALF_OPEN and resets to CLOSED on recovery', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 30, successThreshold: 1 });

    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    expect(cb.getState()).toBe(CircuitState.OPEN);

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 40));

    expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

    // Successful trial execution in HALF_OPEN
    const res = await cb.execute(async () => 'recovered');
    expect(res).toBe('recovered');
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });
});
