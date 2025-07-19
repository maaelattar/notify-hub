import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MetricsService } from '../common/services/metrics.service';
import { QueueHealthIndicator } from '../common/health/queue-health.indicator';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'notifications',
    }),
  ],
  controllers: [],
  providers: [MetricsService, QueueHealthIndicator],
  exports: [MetricsService, QueueHealthIndicator],
})
export class SharedModule {}
