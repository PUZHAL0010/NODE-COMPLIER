/**
 * Enterprise Circuit Breaker Pattern
 * Protects downstream execution services and sandboxes against cascading failures.
 * Implements CLOSED, OPEN, and HALF_OPEN state machine with automated recovery.
 */

import { CircuitBreakerError } from './errors';
import { logger } from './logger';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
  name: string;
  failureThreshold: number; // Number of failures before tripping
  resetTimeoutMs: number;   // Duration in OPEN state before attempting HALF_OPEN probe
  successThreshold: number; // Successful executions in HALF_OPEN to reset to CLOSED
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private nextAttemptAt = 0;
  private readonly config: CircuitBreakerConfig;
  private onTripListeners: Array<(error: Error, state: CircuitState) => void> = [];

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      name: config?.name || 'ExecutionCircuitBreaker',
      failureThreshold: config?.failureThreshold || 5,
      resetTimeoutMs: config?.resetTimeoutMs || 20000,
      successThreshold: config?.successThreshold || 2,
    };
  }

  public getState(): CircuitState {
    if (this.state === CircuitState.OPEN && Date.now() >= this.nextAttemptAt) {
      this.state = CircuitState.HALF_OPEN;
      logger.info({ circuit: this.config.name }, 'Circuit breaker transitioning to HALF_OPEN (probing recovery)');
    }
    return this.state;
  }

  public onTrip(listener: (error: Error, state: CircuitState) => void): void {
    this.onTripListeners.push(listener);
  }

  public async execute<T>(action: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === CircuitState.OPEN) {
      const remainingSec = Math.ceil((this.nextAttemptAt - Date.now()) / 1000);
      throw new CircuitBreakerError(
        `Service execution circuit breaker is OPEN due to elevated sandbox failures. Fast-failing to preserve host stability. Retry in ${remainingSec}s.`
      );
    }

    try {
      const result = await action();
      this.recordSuccess();
      return result;
    } catch (err: any) {
      this.recordFailure(err);
      throw err;
    }
  }

  private recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        logger.info({ circuit: this.config.name }, 'Circuit breaker successfully restored to CLOSED');
      }
    } else if (this.state === CircuitState.CLOSED) {
      this.failureCount = 0;
    }
  }

  private recordFailure(error: Error): void {
    this.failureCount++;
    logger.warn(
      { circuit: this.config.name, failures: this.failureCount, threshold: this.config.failureThreshold },
      'Circuit breaker registered execution failure'
    );

    if (this.state === CircuitState.HALF_OPEN || this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttemptAt = Date.now() + this.config.resetTimeoutMs;
      logger.error(
        { circuit: this.config.name, nextAttemptInMs: this.config.resetTimeoutMs },
        'Circuit breaker TRIPPED to OPEN - cascading failure protection engaged'
      );

      for (const listener of this.onTripListeners) {
        try {
          listener(error, this.state);
        } catch (e) {
          logger.error({ e }, 'Error inside circuit breaker trip listener');
        }
      }
    }
  }

  public reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptAt = 0;
  }

  public getSnapshot() {
    return {
      name: this.config.name,
      state: this.getState(),
      failureCount: this.failureCount,
      successCount: this.successCount,
      nextAttemptAt: this.nextAttemptAt > 0 ? new Date(this.nextAttemptAt).toISOString() : null,
    };
  }
}
