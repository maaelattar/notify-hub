import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';

// Health Services
import { AdvancedHealthService } from './health/advanced-health.service';
import { QueueHealthIndicator } from './health/queue-health.indicator';
import { HealthController } from './health/health.controller';

// Performance Services
import { PerformanceMonitorService } from './performance/performance-monitor.service';

// Metrics Services
import { MetricsService } from './services/metrics.service';
import { RedisMetricsService } from './services/redis-metrics.service';

// Common Dependencies
import { RedisProvider } from '../common/providers/redis.provider';
import { CacheService } from '../../common/services/cache.service';

/**
 * MonitoringModule - Centralized monitoring, health checks, and performance tracking
 *
 * Features:
 * - Advanced health monitoring for all system components
 * - Real-time performance metrics and alerting
 * - Queue health monitoring and management
 * - Redis-based metrics storage and aggregation
 * - System resource monitoring
 *
 * Services Provided:
 * - AdvancedHealthService: Comprehensive system health reports
 * - PerformanceMonitorService: Real-time performance tracking
 * - QueueHealthIndicator: Queue system monitoring
 * - RedisMetricsService: Persistent metrics storage
 * - MetricsService: In-memory metrics (fallback)
 */
@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({
      name: 'notifications',
    }),
    // Note: TypeOrmModule is imported to access DataSource for health checks
    TypeOrmModule.forFeature([]),
  ],
  controllers: [HealthController],
  providers: [
    // Core monitoring services
    AdvancedHealthService,
    PerformanceMonitorService,
    QueueHealthIndicator,

    // Metrics services
    RedisMetricsService,
    MetricsService,

    // Dependencies
    RedisProvider,
    CacheService,
  ],
  exports: [
    // Export core monitoring services for other modules
    AdvancedHealthService,
    PerformanceMonitorService,
    QueueHealthIndicator,
    RedisMetricsService,
    MetricsService,
  ],
})
export class MonitoringModule {}
