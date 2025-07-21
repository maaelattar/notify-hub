import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { CacheService } from '../../../common/services/cache.service';
import { RedisMetricsService } from '../services/redis-metrics.service';
import { EventBusService } from '../../events/event-bus.service';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'down';
  timestamp: Date;
  duration: number; // milliseconds
  details?: Record<string, any>;
  error?: string;
}

export interface SystemHealthReport {
  status: 'healthy' | 'degraded' | 'down';
  timestamp: Date;
  version: string;
  uptime: number; // seconds
  components: {
    database: HealthCheckResult;
    cache: HealthCheckResult;
    queue: HealthCheckResult;
    eventBus: HealthCheckResult;
    dependencies: HealthCheckResult;
  };
  performance: {
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
    eventLoopDelay: number;
  };
  metrics: {
    requestCount: number;
    errorRate: number;
    avgResponseTime: number;
    activeConnections: number;
  };
}

/**
 * Advanced health monitoring service with comprehensive system checks
 * Provides detailed health reports for all system components
 * Includes performance metrics and dependency monitoring
 */
@Injectable()
export class AdvancedHealthService {
  private readonly logger = new Logger(AdvancedHealthService.name);
  private readonly startTime = Date.now();

  constructor(
    private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
    private readonly metricsService: RedisMetricsService,
    private readonly eventBus: EventBusService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Get comprehensive system health report
   */
  async getSystemHealth(): Promise<SystemHealthReport> {
    const startTime = Date.now();

    this.logger.debug('Starting comprehensive health check');

    try {
      // Run all health checks in parallel for better performance
      const [
        databaseHealth,
        cacheHealth,
        queueHealth,
        eventBusHealth,
        dependenciesHealth,
        performanceMetrics,
        systemMetrics,
      ] = await Promise.all([
        this.checkDatabase(),
        this.checkCache(),
        this.checkQueue(),
        this.checkEventBus(),
        this.checkDependencies(),
        this.getPerformanceMetrics(),
        this.getSystemMetrics(),
      ]);

      // Determine overall system status
      const componentStatuses = [
        databaseHealth.status,
        cacheHealth.status,
        queueHealth.status,
        eventBusHealth.status,
        dependenciesHealth.status,
      ];

      const overallStatus = this.determineOverallStatus(componentStatuses);

      const report: SystemHealthReport = {
        status: overallStatus,
        timestamp: new Date(),
        version: this.configService.get<string>('npm_package_version', '1.0.0'),
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        components: {
          database: databaseHealth,
          cache: cacheHealth,
          queue: queueHealth,
          eventBus: eventBusHealth,
          dependencies: dependenciesHealth,
        },
        performance: performanceMetrics,
        metrics: systemMetrics,
      };

      const duration = Date.now() - startTime;

      this.logger.debug('Health check completed', {
        status: overallStatus,
        duration,
        componentCount: Object.keys(report.components).length,
      });

      return report;
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error('Health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
      });

      // Return degraded status with error information
      return {
        status: 'down',
        timestamp: new Date(),
        version: this.configService.get<string>('npm_package_version', '1.0.0'),
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        components: {
          database: {
            status: 'down',
            timestamp: new Date(),
            duration: 0,
            error: 'Health check failed',
          },
          cache: {
            status: 'down',
            timestamp: new Date(),
            duration: 0,
            error: 'Health check failed',
          },
          queue: {
            status: 'down',
            timestamp: new Date(),
            duration: 0,
            error: 'Health check failed',
          },
          eventBus: {
            status: 'down',
            timestamp: new Date(),
            duration: 0,
            error: 'Health check failed',
          },
          dependencies: {
            status: 'down',
            timestamp: new Date(),
            duration: 0,
            error: 'Health check failed',
          },
        },
        performance: {
          memoryUsage: process.memoryUsage(),
          cpuUsage: process.cpuUsage(),
          eventLoopDelay: 0,
        },
        metrics: {
          requestCount: 0,
          errorRate: 0,
          avgResponseTime: 0,
          activeConnections: 0,
        },
      };
    }
  }

  /**
   * Check database connectivity and performance
   */
  async checkDatabase(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      // Test basic connectivity
      await this.dataSource.query('SELECT 1');

      // Test write performance
      const writeStart = Date.now();
      await this.dataSource.query('SELECT NOW()');
      const writeLatency = Date.now() - writeStart;

      // Get connection pool status
      const poolStatus = this.dataSource.driver.master;

      const duration = Date.now() - startTime;

      let status: 'healthy' | 'degraded' | 'down' = 'healthy';
      if (duration > 1000) {
        status = 'degraded';
      } else if (duration > 5000) {
        status = 'down';
      }

      return {
        status,
        timestamp: new Date(),
        duration,
        details: {
          writeLatency,
          isConnected: this.dataSource.isInitialized,
          poolSize: poolStatus?.options?.connectionLimit || 'unknown',
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error('Database health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
      });

      return {
        status: 'down',
        timestamp: new Date(),
        duration,
        error:
          error instanceof Error ? error.message : 'Database connection failed',
      };
    }
  }

  /**
   * Check cache service health
   */
  async checkCache(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const cacheHealth = await this.cacheService.getHealth();
      const duration = Date.now() - startTime;

      return {
        status: cacheHealth.status,
        timestamp: new Date(),
        duration,
        details: {
          latency: cacheHealth.latency,
          memory: cacheHealth.memory,
          connections: cacheHealth.connections,
          hitRate: cacheHealth.stats.hitRate,
          totalOperations: cacheHealth.stats.totalOperations,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error('Cache health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
      });

      return {
        status: 'down',
        timestamp: new Date(),
        duration,
        error:
          error instanceof Error ? error.message : 'Cache service unavailable',
      };
    }
  }

  /**
   * Check queue system health
   */
  async checkQueue(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      // Check queue metrics via Redis metrics service
      const queueMetrics = await this.metricsService.getQueueMetrics();
      const duration = Date.now() - startTime;

      // Determine status based on queue health
      let status: 'healthy' | 'degraded' | 'down' = 'healthy';
      if (queueMetrics.pendingJobs > 1000) {
        status = 'degraded';
      } else if (queueMetrics.failedJobs > 100) {
        status = 'degraded';
      }

      return {
        status,
        timestamp: new Date(),
        duration,
        details: {
          pendingJobs: queueMetrics.pendingJobs,
          completedJobs: queueMetrics.completedJobs,
          failedJobs: queueMetrics.failedJobs,
          processingJobs: queueMetrics.processingJobs,
          workers: queueMetrics.workers,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error('Queue health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
      });

      return {
        status: 'down',
        timestamp: new Date(),
        duration,
        error:
          error instanceof Error ? error.message : 'Queue system unavailable',
      };
    }
  }

  /**
   * Check event bus health
   */
  async checkEventBus(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const eventStats = this.eventBus.getEventStats();
      const duration = Date.now() - startTime;

      return {
        status: 'healthy',
        timestamp: new Date(),
        duration,
        details: {
          registeredHandlers: eventStats.registeredHandlers,
          totalHandlers: eventStats.totalHandlers,
          eventEmitterListeners: eventStats.eventEmitterListeners,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error('Event bus health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
      });

      return {
        status: 'down',
        timestamp: new Date(),
        duration,
        error: error instanceof Error ? error.message : 'Event bus unavailable',
      };
    }
  }

  /**
   * Check external dependencies
   */
  async checkDependencies(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      // Check external service endpoints (example)
      const dependencyChecks = await Promise.allSettled([
        // Add your external service checks here
        // this.checkEmailService(),
        // this.checkSmsService(),
        // this.checkWebhookService(),
      ]);

      const duration = Date.now() - startTime;

      // Determine status based on dependency results
      const failedChecks = dependencyChecks.filter(
        (result) => result.status === 'rejected',
      ).length;
      const totalChecks = dependencyChecks.length;

      let status: 'healthy' | 'degraded' | 'down' = 'healthy';
      if (failedChecks > 0 && failedChecks < totalChecks) {
        status = 'degraded';
      } else if (failedChecks === totalChecks && totalChecks > 0) {
        status = 'down';
      }

      return {
        status,
        timestamp: new Date(),
        duration,
        details: {
          totalChecks,
          failedChecks,
          successRate:
            totalChecks > 0
              ? ((totalChecks - failedChecks) / totalChecks) * 100
              : 100,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error('Dependencies health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
      });

      return {
        status: 'degraded',
        timestamp: new Date(),
        duration,
        error:
          error instanceof Error
            ? error.message
            : 'Some dependencies unavailable',
      };
    }
  }

  /**
   * Get performance metrics
   */
  private getPerformanceMetrics(): {
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
    eventLoopDelay: number;
  } {
    return {
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      eventLoopDelay: this.getEventLoopDelay(),
    };
  }

  /**
   * Get system metrics
   */
  private async getSystemMetrics(): Promise<{
    requestCount: number;
    errorRate: number;
    avgResponseTime: number;
    activeConnections: number;
  }> {
    try {
      // Get metrics from Redis metrics service
      const [requestCount, errorCount, responseTimeTotal, activeConnections] =
        await Promise.all([
          this.metricsService.getCounter('http.requests.total'),
          this.metricsService.getCounter('http.errors.total'),
          this.metricsService.getCounter('http.response_time.total'),
          this.metricsService.getCounter('http.connections.active'),
        ]);

      const errorRate =
        requestCount > 0 ? (errorCount / requestCount) * 100 : 0;
      const avgResponseTime =
        requestCount > 0 ? responseTimeTotal / requestCount : 0;

      return {
        requestCount,
        errorRate,
        avgResponseTime,
        activeConnections,
      };
    } catch (error) {
      this.logger.warn('Failed to get system metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        requestCount: 0,
        errorRate: 0,
        avgResponseTime: 0,
        activeConnections: 0,
      };
    }
  }

  /**
   * Determine overall system status
   */
  private determineOverallStatus(
    componentStatuses: string[],
  ): 'healthy' | 'degraded' | 'down' {
    const downComponents = componentStatuses.filter(
      (status) => status === 'down',
    ).length;
    const degradedComponents = componentStatuses.filter(
      (status) => status === 'degraded',
    ).length;

    if (downComponents > 0) {
      return 'down';
    } else if (degradedComponents > 0) {
      return 'degraded';
    } else {
      return 'healthy';
    }
  }

  /**
   * Get event loop delay (simplified)
   */
  private getEventLoopDelay(): number {
    // In a real implementation, you would use perf_hooks or a similar library
    // For now, return 0 as a placeholder
    return 0;
  }

  /**
   * Get simple health status for quick checks
   */
  async getSimpleHealth(): Promise<{ status: string; timestamp: Date }> {
    try {
      // Quick database check
      await this.dataSource.query('SELECT 1');

      return {
        status: 'healthy',
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        status: 'down',
        timestamp: new Date(),
      };
    }
  }
}
