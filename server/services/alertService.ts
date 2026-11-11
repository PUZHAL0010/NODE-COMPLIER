/**
 * Real-Time System & Crash Alerting Service
 * Implements Observer and Singleton patterns for instantaneous failure notifications,
 * security alarms, circuit breaker trips, and telemetry broadcasting.
 */

import EventEmitter from 'events';
import { nanoid } from 'nanoid';
import Redis from 'ioredis';
import { SystemAlert, AlertSeverity, AlertCategory } from '../../shared/types';
import { logger } from '../utils/logger';

export class AlertService {
  private static instance: AlertService;
  private emitter = new EventEmitter();
  private recentAlerts: SystemAlert[] = [];
  private readonly maxStoredAlerts = 200;
  private redisPublisher: Redis | null = null;
  private isRedisReady = false;

  private constructor() {
    this.emitter.setMaxListeners(500);
    this.initRedis();
  }

  public static getInstance(): AlertService {
    if (!AlertService.instance) {
      AlertService.instance = new AlertService();
    }
    return AlertService.instance;
  }

  private initRedis(): void {
    const redisConfig = {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      lazyConnect: true,
      retryStrategy: (times: number) => Math.min(times * 200, 3000),
    };

    try {
      this.redisPublisher = new Redis(redisConfig as any);
      this.redisPublisher.on('connect', () => {
        this.isRedisReady = true;
        logger.info('AlertService: Redis alert broadcaster connected');
      });
      this.redisPublisher.on('error', () => {
        this.isRedisReady = false;
      });
      this.redisPublisher.connect().catch(() => {});
    } catch {
      this.isRedisReady = false;
    }
  }

  /**
   * Broadcast an immediate alert across the cluster and local listeners
   */
  public recordAlert(params: {
    severity: AlertSeverity;
    category: AlertCategory;
    message: string;
    jobId?: string;
    traceId?: string;
    details?: Record<string, unknown>;
  }): SystemAlert {
    const alert: SystemAlert = {
      alertId: `alert-${Date.now()}-${nanoid(6)}`,
      timestamp: new Date().toISOString(),
      severity: params.severity,
      category: params.category,
      jobId: params.jobId,
      traceId: params.traceId,
      message: params.message,
      details: params.details,
      systemMetricsSnapshot: {
        memoryUsageBytes: process.memoryUsage().heapUsed,
        uptimeSeconds: Math.round(process.uptime()),
        activeJobs: 0,
      },
    };

    // Store in bounded ring buffer
    this.recentAlerts.unshift(alert);
    if (this.recentAlerts.length > this.maxStoredAlerts) {
      this.recentAlerts.pop();
    }

    // Structured logging
    if (alert.severity === 'CRITICAL') {
      logger.error({ alert }, `[SYSTEM ALERT CRITICAL] ${alert.message}`);
    } else if (alert.severity === 'WARNING') {
      logger.warn({ alert }, `[SYSTEM ALERT WARNING] ${alert.message}`);
    } else {
      logger.info({ alert }, `[SYSTEM ALERT INFO] ${alert.message}`);
    }

    // 1. Emit locally for active SSE connections and gateway
    this.emitter.emit('alert', alert);
    if (alert.jobId) {
      this.emitter.emit(`alert:${alert.jobId}`, alert);
    }

    // 2. Publish to Redis if connected for distributed cross-node alerting
    if (this.isRedisReady && this.redisPublisher && this.redisPublisher.status === 'ready') {
      this.redisPublisher.publish('system-alerts', JSON.stringify(alert)).catch((err) => {
        logger.debug({ err }, 'Failed to publish alert to Redis');
      });
    }

    return alert;
  }

  /**
   * Record sandbox or process crash
   */
  public recordCrash(jobId: string, traceId: string, error: Error | string, details?: Record<string, unknown>): SystemAlert {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    return this.recordAlert({
      severity: 'CRITICAL',
      category: 'CRASH',
      jobId,
      traceId,
      message: `Execution crash detected in job ${jobId}: ${errorMsg}`,
      details: {
        ...details,
        stack,
        hostStatus: 'OPERATIONAL_ISOLATED',
      },
    });
  }

  /**
   * Record execution timeout
   */
  public recordTimeout(jobId: string, timeoutMs: number, traceId?: string): SystemAlert {
    return this.recordAlert({
      severity: 'WARNING',
      category: 'TIMEOUT',
      jobId,
      traceId,
      message: `Job ${jobId} exceeded execution threshold of ${timeoutMs}ms and was reaped.`,
      details: { timeoutMs },
    });
  }

  /**
   * Record security policy violation
   */
  public recordSecurityIncident(rule: string, message: string, details?: Record<string, unknown>): SystemAlert {
    return this.recordAlert({
      severity: 'WARNING',
      category: 'SECURITY',
      message: `Security Policy Violation [${rule}]: ${message}`,
      details,
    });
  }

  /**
   * Record Circuit Breaker Trip
   */
  public recordCircuitTrip(circuitName: string, message: string): SystemAlert {
    return this.recordAlert({
      severity: 'CRITICAL',
      category: 'CIRCUIT_BREAKER',
      message: `Circuit Breaker [${circuitName}] tripped to OPEN: ${message}`,
    });
  }

  /**
   * Subscribe to all real-time alerts
   */
  public subscribe(callback: (alert: SystemAlert) => void): () => void {
    this.emitter.on('alert', callback);
    return () => {
      this.emitter.off('alert', callback);
    };
  }

  /**
   * Subscribe to alerts for a specific job
   */
  public subscribeToJob(jobId: string, callback: (alert: SystemAlert) => void): () => void {
    const channel = `alert:${jobId}`;
    this.emitter.on(channel, callback);
    return () => {
      this.emitter.off(channel, callback);
    };
  }

  /**
   * Get list of recent alerts
   */
  public getRecentAlerts(limit: number = 50): SystemAlert[] {
    return this.recentAlerts.slice(0, Math.min(limit, this.recentAlerts.length));
  }

  public clearAlerts(): void {
    this.recentAlerts = [];
  }
}
