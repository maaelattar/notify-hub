import { Injectable, Logger } from '@nestjs/common';
import { format, startOfHour } from 'date-fns';
import { RedisProvider } from '../providers/redis.provider';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';

export interface NotificationMetrics {
  notificationsSent: number;
  notificationsFailed: number;
  averageProcessingTime: number;
  successRate: number;
  channelBreakdown: Record<string, { sent: number; failed: number }>;
  priorityBreakdown: Record<string, { sent: number; failed: number }>;
}

@Injectable()
export class RedisMetricsService {
  private readonly logger = new Logger(RedisMetricsService.name);

  // Redis key prefixes
  private readonly METRICS_PREFIX = 'metrics';
  private readonly PROCESSING_TIMES_PREFIX = 'processing_times';

  // TTL configurations (in seconds)
  private readonly METRICS_TTL = 7 * 24 * 3600; // 7 days
  private readonly PROCESSING_TIMES_TTL = 24 * 3600; // 24 hours
  private readonly MAX_PROCESSING_TIMES = 1000; // Max processing times per hour

  constructor(private readonly redisProvider: RedisProvider) {}

  private getClient() {
    return this.redisProvider.getClient();
  }

  /**
   * Generate time-bucketed key for metrics (hourly buckets)
   */
  private getTimeKey(date: Date = new Date()): string {
    const hourBucket = startOfHour(date);
    return format(hourBucket, 'yyyy-MM-dd-HH');
  }

  /**
   * Generate Redis key for metrics
   */
  private getMetricsKey(timeKey: string, type: string): string {
    return `${this.METRICS_PREFIX}:${timeKey}:${type}`;
  }

  /**
   * Generate Redis key for processing times
   */
  private getProcessingTimesKey(timeKey: string): string {
    return `${this.PROCESSING_TIMES_PREFIX}:${timeKey}`;
  }

  async recordNotificationSent(
    channel: string,
    priority: NotificationPriority,
    processingTime: number,
  ): Promise<void> {
    try {
      const redis = this.getClient();
      const timeKey = this.getTimeKey();

      // Use pipeline for atomic operations
      const pipeline = redis.pipeline();

      // Increment counters
      pipeline.hincrby(this.getMetricsKey(timeKey, 'sent'), 'total', 1);
      pipeline.hincrby(
        this.getMetricsKey(timeKey, 'sent'),
        `channel:${channel}`,
        1,
      );
      pipeline.hincrby(
        this.getMetricsKey(timeKey, 'sent'),
        `priority:${priority}`,
        1,
      );

      // Store processing time (use list with max size)
      const processingTimesKey = this.getProcessingTimesKey(timeKey);
      pipeline.lpush(processingTimesKey, processingTime);
      pipeline.ltrim(processingTimesKey, 0, this.MAX_PROCESSING_TIMES - 1);

      // Set TTL for automatic cleanup
      pipeline.expire(this.getMetricsKey(timeKey, 'sent'), this.METRICS_TTL);
      pipeline.expire(processingTimesKey, this.PROCESSING_TIMES_TTL);

      await pipeline.exec();

      this.logger.debug(
        `Recorded successful notification: ${channel}, ${priority}, ${processingTime}ms`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to record notification sent metric',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  async recordNotificationFailed(
    priority: NotificationPriority,
    error: string,
    channel?: string,
  ): Promise<void> {
    try {
      const redis = this.getClient();
      const timeKey = this.getTimeKey();

      const pipeline = redis.pipeline();

      // Increment failed counters
      pipeline.hincrby(this.getMetricsKey(timeKey, 'failed'), 'total', 1);
      pipeline.hincrby(
        this.getMetricsKey(timeKey, 'failed'),
        `priority:${priority}`,
        1,
      );

      if (channel) {
        pipeline.hincrby(
          this.getMetricsKey(timeKey, 'failed'),
          `channel:${channel}`,
          1,
        );
      }

      // Set TTL
      pipeline.expire(this.getMetricsKey(timeKey, 'failed'), this.METRICS_TTL);

      await pipeline.exec();

      this.logger.debug(`Recorded failed notification: ${priority}, ${error}`);
    } catch (error) {
      this.logger.error(
        'Failed to record notification failed metric',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  async recordChannelDelivery(
    channel: string,
    success: boolean,
    duration: number,
  ): Promise<void> {
    try {
      const redis = this.getClient();
      const timeKey = this.getTimeKey();

      const pipeline = redis.pipeline();

      if (success) {
        pipeline.hincrby(
          this.getMetricsKey(timeKey, 'sent'),
          `channel:${channel}`,
          1,
        );

        // Record processing time
        const processingTimesKey = this.getProcessingTimesKey(timeKey);
        pipeline.lpush(processingTimesKey, duration);
        pipeline.ltrim(processingTimesKey, 0, this.MAX_PROCESSING_TIMES - 1);
        pipeline.expire(processingTimesKey, this.PROCESSING_TIMES_TTL);
      } else {
        pipeline.hincrby(
          this.getMetricsKey(timeKey, 'failed'),
          `channel:${channel}`,
          1,
        );
      }

      // Set TTL
      pipeline.expire(this.getMetricsKey(timeKey, 'sent'), this.METRICS_TTL);
      pipeline.expire(this.getMetricsKey(timeKey, 'failed'), this.METRICS_TTL);

      await pipeline.exec();

      this.logger.debug(
        `Channel delivery: ${channel}, success: ${success}, duration: ${duration}ms`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to record channel delivery metric',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  async getMetrics(): Promise<NotificationMetrics> {
    try {
      const redis = this.getClient();

      // Get metrics from the last 24 hours (24 hourly buckets)
      const now = new Date();
      const timeKeys: string[] = [];

      for (let i = 0; i < 24; i++) {
        const hourAgo = new Date(now.getTime() - i * 60 * 60 * 1000);
        timeKeys.push(this.getTimeKey(hourAgo));
      }

      // Aggregate metrics across time buckets
      let totalSent = 0;
      let totalFailed = 0;
      const channelBreakdown: Record<string, { sent: number; failed: number }> =
        {};
      const priorityBreakdown: Record<
        string,
        { sent: number; failed: number }
      > = {};
      let allProcessingTimes: number[] = [];

      // Use pipeline for efficient batch operations
      const pipeline = redis.pipeline();

      // Queue all Redis operations
      timeKeys.forEach((timeKey) => {
        pipeline.hgetall(this.getMetricsKey(timeKey, 'sent'));
        pipeline.hgetall(this.getMetricsKey(timeKey, 'failed'));
        pipeline.lrange(this.getProcessingTimesKey(timeKey), 0, -1);
      });

      const results = await pipeline.exec();

      if (!results) {
        return this.getEmptyMetrics();
      }

      // Process results (groups of 3: sent, failed, processing_times)
      for (let i = 0; i < results.length; i += 3) {
        const sentResult = results[i];
        const failedResult = results[i + 1];
        const processingTimesResult = results[i + 2];

        if (sentResult && sentResult[1]) {
          const sentData = sentResult[1] as Record<string, string>;
          this.aggregateMetrics(
            sentData,
            channelBreakdown,
            priorityBreakdown,
            'sent',
          );
          totalSent += parseInt(sentData.total || '0', 10);
        }

        if (failedResult && failedResult[1]) {
          const failedData = failedResult[1] as Record<string, string>;
          this.aggregateMetrics(
            failedData,
            channelBreakdown,
            priorityBreakdown,
            'failed',
          );
          totalFailed += parseInt(failedData.total || '0', 10);
        }

        if (processingTimesResult && processingTimesResult[1]) {
          const times = (processingTimesResult[1] as string[])
            .map((t) => parseInt(t, 10))
            .filter((t) => !isNaN(t));
          allProcessingTimes = allProcessingTimes.concat(times);
        }
      }

      // Calculate averages and rates
      const total = totalSent + totalFailed;
      const averageProcessingTime =
        allProcessingTimes.length > 0
          ? Math.round(
              allProcessingTimes.reduce((sum, time) => sum + time, 0) /
                allProcessingTimes.length,
            )
          : 0;
      const successRate =
        total > 0 ? Math.round((totalSent / total) * 10000) / 100 : 0;

      return {
        notificationsSent: totalSent,
        notificationsFailed: totalFailed,
        averageProcessingTime,
        successRate,
        channelBreakdown,
        priorityBreakdown,
      };
    } catch (error) {
      this.logger.error(
        'Failed to get metrics',
        error instanceof Error ? error.stack : error,
      );
      return this.getEmptyMetrics();
    }
  }

  private aggregateMetrics(
    data: Record<string, string>,
    channelBreakdown: Record<string, { sent: number; failed: number }>,
    priorityBreakdown: Record<string, { sent: number; failed: number }>,
    type: 'sent' | 'failed',
  ): void {
    Object.keys(data).forEach((key) => {
      const value = parseInt(data[key], 10);

      if (key.startsWith('channel:')) {
        const channel = key.replace('channel:', '');
        if (!channelBreakdown[channel]) {
          channelBreakdown[channel] = { sent: 0, failed: 0 };
        }
        channelBreakdown[channel][type] += value;
      } else if (key.startsWith('priority:')) {
        const priority = key.replace('priority:', '');
        if (!priorityBreakdown[priority]) {
          priorityBreakdown[priority] = { sent: 0, failed: 0 };
        }
        priorityBreakdown[priority][type] += value;
      }
    });
  }

  private getEmptyMetrics(): NotificationMetrics {
    return {
      notificationsSent: 0,
      notificationsFailed: 0,
      averageProcessingTime: 0,
      successRate: 0,
      channelBreakdown: {},
      priorityBreakdown: {},
    };
  }

  async resetMetrics(): Promise<void> {
    try {
      const redis = this.getClient();

      // Find all metrics keys
      const sentKeys = await redis.keys(`${this.METRICS_PREFIX}:*:sent`);
      const failedKeys = await redis.keys(`${this.METRICS_PREFIX}:*:failed`);
      const processingKeys = await redis.keys(
        `${this.PROCESSING_TIMES_PREFIX}:*`,
      );

      const allKeys = [...sentKeys, ...failedKeys, ...processingKeys];

      if (allKeys.length > 0) {
        await redis.del(...allKeys);
      }

      this.logger.log('Metrics reset successfully');
    } catch (error) {
      this.logger.error(
        'Failed to reset metrics',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /**
   * Health check method
   */
  async healthCheck(): Promise<{
    redis: boolean;
    metricsOperational: boolean;
  }> {
    try {
      const redisHealthy = await this.redisProvider.ping();

      // Test basic metrics operation
      let metricsOperational = false;
      if (redisHealthy) {
        const testKey = `${this.METRICS_PREFIX}:health:test`;
        await this.getClient().set(testKey, '1', 'EX', 60);
        const result = await this.getClient().get(testKey);
        await this.getClient().del(testKey);
        metricsOperational = result === '1';
      }

      return {
        redis: redisHealthy,
        metricsOperational,
      };
    } catch (error) {
      this.logger.error('Health check failed:', error);
      return {
        redis: false,
        metricsOperational: false,
      };
    }
  }
}
