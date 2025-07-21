import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../../common/services/cache.service';
import { EventBusService } from '../../events/event-bus.service';

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: Date;
  tags?: Record<string, string>;
}

export interface PerformanceThreshold {
  metric: string;
  warning: number;
  critical: number;
  operator: 'gt' | 'lt' | 'gte' | 'lte';
}

export interface PerformanceAlert {
  metric: string;
  value: number;
  threshold: number;
  severity: 'warning' | 'critical';
  timestamp: Date;
  message: string;
}

/**
 * Advanced performance monitoring service
 * Tracks key performance indicators and provides alerts for threshold violations
 * Includes automatic memory monitoring, response time tracking, and custom metrics
 */
@Injectable()
export class PerformanceMonitorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PerformanceMonitorService.name);
  private readonly metrics = new Map<string, PerformanceMetric[]>();
  private readonly thresholds = new Map<string, PerformanceThreshold>();
  private readonly alerts: PerformanceAlert[] = [];
  private monitoringInterval?: NodeJS.Timeout;
  private readonly maxMetricsHistory: number;
  private readonly monitoringIntervalMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
  ) {
    this.maxMetricsHistory = this.configService.get<number>(
      'PERFORMANCE_MAX_HISTORY',
      1000,
    );
    this.monitoringIntervalMs = this.configService.get<number>(
      'PERFORMANCE_MONITOR_INTERVAL',
      10000,
    ); // 10 seconds

    this.setupDefaultThresholds();
  }

  onModuleInit() {
    this.startMonitoring();
    this.logger.log('Performance monitoring started');
  }

  onModuleDestroy() {
    this.stopMonitoring();
    this.logger.log('Performance monitoring stopped');
  }

  /**
   * Record a custom performance metric
   */
  recordMetric(
    name: string,
    value: number,
    unit: string = 'count',
    tags: Record<string, string> = {},
  ): void {
    const metric: PerformanceMetric = {
      name,
      value,
      unit,
      timestamp: new Date(),
      tags,
    };

    // Store metric in memory
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metricHistory = this.metrics.get(name)!;
    metricHistory.push(metric);

    // Keep only recent metrics
    if (metricHistory.length > this.maxMetricsHistory) {
      metricHistory.shift();
    }

    // Check thresholds
    this.checkThreshold(metric);

    this.logger.debug('Recorded performance metric', {
      name,
      value,
      unit,
      tags,
    });
  }

  /**
   * Record response time metric
   */
  recordResponseTime(
    endpoint: string,
    method: string,
    statusCode: number,
    duration: number,
  ): void {
    this.recordMetric('http.response_time', duration, 'ms', {
      endpoint,
      method,
      status_code: statusCode.toString(),
    });

    // Also record request count
    this.recordMetric('http.requests.total', 1, 'count', {
      endpoint,
      method,
      status_code: statusCode.toString(),
    });

    // Record error rate if applicable
    if (statusCode >= 400) {
      this.recordMetric('http.errors.total', 1, 'count', {
        endpoint,
        method,
        status_code: statusCode.toString(),
      });
    }
  }

  /**
   * Record database query performance
   */
  recordDatabaseQuery(
    query: string,
    duration: number,
    recordCount?: number,
  ): void {
    this.recordMetric('database.query_time', duration, 'ms', {
      query_type: this.extractQueryType(query),
    });

    if (recordCount !== undefined) {
      this.recordMetric('database.records_processed', recordCount, 'count', {
        query_type: this.extractQueryType(query),
      });
    }
  }

  /**
   * Record cache operation performance
   */
  recordCacheOperation(
    operation: 'get' | 'set' | 'delete',
    hit: boolean,
    duration: number,
  ): void {
    this.recordMetric('cache.operation_time', duration, 'ms', {
      operation,
      result: hit ? 'hit' : 'miss',
    });

    this.recordMetric('cache.operations.total', 1, 'count', {
      operation,
      result: hit ? 'hit' : 'miss',
    });
  }

  /**
   * Record queue operation performance
   */
  recordQueueOperation(
    queue: string,
    operation: 'add' | 'process' | 'complete' | 'fail',
    duration?: number,
  ): void {
    this.recordMetric('queue.operations.total', 1, 'count', {
      queue,
      operation,
    });

    if (duration !== undefined) {
      this.recordMetric('queue.processing_time', duration, 'ms', {
        queue,
        operation,
      });
    }
  }

  /**
   * Get performance metrics for a specific metric name
   */
  getMetrics(name: string, limit: number = 100): PerformanceMetric[] {
    const metrics = this.metrics.get(name) || [];
    return metrics.slice(-limit);
  }

  /**
   * Get aggregated metrics
   */
  getAggregatedMetrics(
    name: string,
    aggregation: 'avg' | 'min' | 'max' | 'sum' | 'count',
    timeWindow?: number, // minutes
  ): number {
    const metrics = this.metrics.get(name) || [];

    let filteredMetrics = metrics;
    if (timeWindow) {
      const cutoff = new Date(Date.now() - timeWindow * 60 * 1000);
      filteredMetrics = metrics.filter((m) => m.timestamp >= cutoff);
    }

    if (filteredMetrics.length === 0) {
      return 0;
    }

    const values = filteredMetrics.map((m) => m.value);

    switch (aggregation) {
      case 'avg':
        return values.reduce((sum, val) => sum + val, 0) / values.length;
      case 'min':
        return Math.min(...values);
      case 'max':
        return Math.max(...values);
      case 'sum':
        return values.reduce((sum, val) => sum + val, 0);
      case 'count':
        return values.length;
      default:
        return 0;
    }
  }

  /**
   * Set performance threshold
   */
  setThreshold(threshold: PerformanceThreshold): void {
    this.thresholds.set(threshold.metric, threshold);

    this.logger.debug('Set performance threshold', {
      metric: threshold.metric,
      warning: threshold.warning,
      critical: threshold.critical,
      operator: threshold.operator,
    });
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(limit: number = 50): PerformanceAlert[] {
    return this.alerts.slice(-limit);
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): {
    totalMetrics: number;
    activeThresholds: number;
    recentAlerts: number;
    systemHealth: {
      responseTime: { avg: number; max: number };
      errorRate: number;
      memoryUsage: number;
      cpuUsage: number;
    };
  } {
    const responseTimeMetrics = this.getMetrics('http.response_time', 100);
    const errorMetrics = this.getMetrics('http.errors.total', 100);
    const requestMetrics = this.getMetrics('http.requests.total', 100);

    const avgResponseTime =
      responseTimeMetrics.length > 0
        ? responseTimeMetrics.reduce((sum, m) => sum + m.value, 0) /
          responseTimeMetrics.length
        : 0;

    const maxResponseTime =
      responseTimeMetrics.length > 0
        ? Math.max(...responseTimeMetrics.map((m) => m.value))
        : 0;

    const totalErrors = errorMetrics.reduce((sum, m) => sum + m.value, 0);
    const totalRequests = requestMetrics.reduce((sum, m) => sum + m.value, 0);
    const errorRate =
      totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

    const memoryUsage = process.memoryUsage();
    const memoryUsagePercent =
      (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;

    return {
      totalMetrics: Array.from(this.metrics.values()).reduce(
        (sum, metrics) => sum + metrics.length,
        0,
      ),
      activeThresholds: this.thresholds.size,
      recentAlerts: this.alerts.filter(
        (alert) => alert.timestamp > new Date(Date.now() - 60 * 60 * 1000), // Last hour
      ).length,
      systemHealth: {
        responseTime: {
          avg: avgResponseTime,
          max: maxResponseTime,
        },
        errorRate,
        memoryUsage: memoryUsagePercent,
        cpuUsage: 0, // Would need process.cpuUsage() calculation
      },
    };
  }

  /**
   * Start automatic system monitoring
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, this.monitoringIntervalMs);
  }

  /**
   * Stop automatic monitoring
   */
  private stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
  }

  /**
   * Collect system-level metrics
   */
  private collectSystemMetrics(): void {
    try {
      // Memory metrics
      const memoryUsage = process.memoryUsage();
      this.recordMetric(
        'system.memory.heap_used',
        memoryUsage.heapUsed,
        'bytes',
      );
      this.recordMetric(
        'system.memory.heap_total',
        memoryUsage.heapTotal,
        'bytes',
      );
      this.recordMetric(
        'system.memory.external',
        memoryUsage.external,
        'bytes',
      );
      this.recordMetric('system.memory.rss', memoryUsage.rss, 'bytes');

      // CPU metrics
      const cpuUsage = process.cpuUsage();
      this.recordMetric('system.cpu.user', cpuUsage.user, 'microseconds');
      this.recordMetric('system.cpu.system', cpuUsage.system, 'microseconds');

      // Process metrics
      this.recordMetric('system.process.uptime', process.uptime(), 'seconds');

      this.logger.debug('Collected system metrics');
    } catch (error) {
      this.logger.error('Failed to collect system metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Check metric against thresholds
   */
  private checkThreshold(metric: PerformanceMetric): void {
    const threshold = this.thresholds.get(metric.name);
    if (!threshold) {
      return;
    }

    const violation = this.evaluateThreshold(metric.value, threshold);
    if (violation) {
      const alert: PerformanceAlert = {
        metric: metric.name,
        value: metric.value,
        threshold:
          violation === 'critical' ? threshold.critical : threshold.warning,
        severity: violation,
        timestamp: new Date(),
        message: `${metric.name} ${violation} threshold exceeded: ${metric.value} ${metric.unit}`,
      };

      this.alerts.push(alert);

      // Keep only recent alerts
      if (this.alerts.length > 1000) {
        this.alerts.shift();
      }

      this.logger.warn('Performance threshold exceeded', {
        metric: metric.name,
        value: metric.value,
        threshold: alert.threshold,
        severity: violation,
      });

      // Publish alert event
      this.publishAlertEvent(alert);
    }
  }

  /**
   * Evaluate if metric violates threshold
   */
  private evaluateThreshold(
    value: number,
    threshold: PerformanceThreshold,
  ): 'warning' | 'critical' | null {
    const exceedsCritical = this.compareValue(
      value,
      threshold.critical,
      threshold.operator,
    );
    const exceedsWarning = this.compareValue(
      value,
      threshold.warning,
      threshold.operator,
    );

    if (exceedsCritical) {
      return 'critical';
    } else if (exceedsWarning) {
      return 'warning';
    }

    return null;
  }

  /**
   * Compare value against threshold using operator
   */
  private compareValue(
    value: number,
    threshold: number,
    operator: string,
  ): boolean {
    switch (operator) {
      case 'gt':
        return value > threshold;
      case 'gte':
        return value >= threshold;
      case 'lt':
        return value < threshold;
      case 'lte':
        return value <= threshold;
      default:
        return false;
    }
  }

  /**
   * Extract query type from SQL string
   */
  private extractQueryType(query: string): string {
    const normalized = query.trim().toLowerCase();
    if (normalized.startsWith('select')) return 'select';
    if (normalized.startsWith('insert')) return 'insert';
    if (normalized.startsWith('update')) return 'update';
    if (normalized.startsWith('delete')) return 'delete';
    return 'other';
  }

  /**
   * Setup default performance thresholds
   */
  private setupDefaultThresholds(): void {
    // Response time thresholds
    this.setThreshold({
      metric: 'http.response_time',
      warning: 1000, // 1 second
      critical: 5000, // 5 seconds
      operator: 'gt',
    });

    // Memory usage thresholds
    this.setThreshold({
      metric: 'system.memory.heap_used',
      warning: 500 * 1024 * 1024, // 500MB
      critical: 1000 * 1024 * 1024, // 1GB
      operator: 'gt',
    });

    // Database query time thresholds
    this.setThreshold({
      metric: 'database.query_time',
      warning: 500, // 500ms
      critical: 2000, // 2 seconds
      operator: 'gt',
    });

    this.logger.debug('Setup default performance thresholds');
  }

  /**
   * Publish alert event
   */
  private async publishAlertEvent(alert: PerformanceAlert): Promise<void> {
    try {
      // In a real implementation, you would create and publish a PerformanceAlertEvent
      // For now, we'll just log it
      this.logger.warn('Performance alert', alert);
    } catch (error) {
      this.logger.error('Failed to publish alert event', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
