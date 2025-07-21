import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { RedisProvider } from '../common/providers/redis.provider';
import { RedisMetricsService } from '../common/services/redis-metrics.service';
import { QueueHealthIndicator } from '../common/health/queue-health.indicator';
import { ErrorGuidanceFactory } from '../../common/services/error-guidance.factory';

// Create alias for backward compatibility
const MetricsService = RedisMetricsService;

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'notifications',
    }),
  ],
  controllers: [],
  providers: [
    RedisProvider,
    RedisMetricsService,
    {
      provide: 'MetricsService',
      useClass: RedisMetricsService,
    },
    QueueHealthIndicator,
    ErrorGuidanceFactory,
  ],
  exports: [
    RedisProvider,
    RedisMetricsService,
    {
      provide: 'MetricsService',
      useClass: RedisMetricsService,
    },
    QueueHealthIndicator,
    ErrorGuidanceFactory,
  ],
})
export class SharedModule {}
