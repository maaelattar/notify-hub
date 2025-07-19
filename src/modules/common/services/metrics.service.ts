import { Injectable, Logger } from '@nestjs/common';
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
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  // In-memory metrics storage (in production, use Redis or database)
  private metrics = {
    sent: new Map<string, number>(),
    failed: new Map<string, number>(),
    processingTimes: [] as number[],
    channelStats: new Map<string, { sent: number; failed: number }>(),
    priorityStats: new Map<string, { sent: number; failed: number }>(),
  };

  recordNotificationSent(
    channel: string,
    priority: NotificationPriority,
    processingTime: number,
  ): void {
    try {
      // Record overall sent count
      const currentSent = this.metrics.sent.get('total') || 0;
      this.metrics.sent.set('total', currentSent + 1);

      // Record processing time
      this.metrics.processingTimes.push(processingTime);

      // Keep only last 1000 processing times to avoid memory issues
      if (this.metrics.processingTimes.length > 1000) {
        this.metrics.processingTimes =
          this.metrics.processingTimes.slice(-1000);
      }

      // Record channel stats
      const channelStats = this.metrics.channelStats.get(channel) || {
        sent: 0,
        failed: 0,
      };
      channelStats.sent++;
      this.metrics.channelStats.set(channel, channelStats);

      // Record priority stats
      const priorityStats = this.metrics.priorityStats.get(priority) || {
        sent: 0,
        failed: 0,
      };
      priorityStats.sent++;
      this.metrics.priorityStats.set(priority, priorityStats);

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

  recordNotificationFailed(
    priority: NotificationPriority,
    error: string,
    channel?: string,
  ): void {
    try {
      // Record overall failed count
      const currentFailed = this.metrics.failed.get('total') || 0;
      this.metrics.failed.set('total', currentFailed + 1);

      // Record channel stats if available
      if (channel) {
        const channelStats = this.metrics.channelStats.get(channel) || {
          sent: 0,
          failed: 0,
        };
        channelStats.failed++;
        this.metrics.channelStats.set(channel, channelStats);
      }

      // Record priority stats
      const priorityStats = this.metrics.priorityStats.get(priority) || {
        sent: 0,
        failed: 0,
      };
      priorityStats.failed++;
      this.metrics.priorityStats.set(priority, priorityStats);

      this.logger.debug(`Recorded failed notification: ${priority}, ${error}`);
    } catch (error) {
      this.logger.error(
        'Failed to record notification failed metric',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  getMetrics(): NotificationMetrics {
    try {
      const totalSent = this.metrics.sent.get('total') || 0;
      const totalFailed = this.metrics.failed.get('total') || 0;
      const total = totalSent + totalFailed;

      const averageProcessingTime =
        this.metrics.processingTimes.length > 0
          ? this.metrics.processingTimes.reduce((sum, time) => sum + time, 0) /
            this.metrics.processingTimes.length
          : 0;

      const successRate = total > 0 ? (totalSent / total) * 100 : 0;

      // Convert maps to objects for response
      const channelBreakdown: Record<string, { sent: number; failed: number }> =
        {};
      this.metrics.channelStats.forEach((stats, channel) => {
        channelBreakdown[channel] = stats;
      });

      const priorityBreakdown: Record<
        string,
        { sent: number; failed: number }
      > = {};
      this.metrics.priorityStats.forEach((stats, priority) => {
        priorityBreakdown[priority] = stats;
      });

      return {
        notificationsSent: totalSent,
        notificationsFailed: totalFailed,
        averageProcessingTime: Math.round(averageProcessingTime),
        successRate: Math.round(successRate * 100) / 100, // Round to 2 decimal places
        channelBreakdown,
        priorityBreakdown,
      };
    } catch (error) {
      this.logger.error(
        'Failed to get metrics',
        error instanceof Error ? error.stack : error,
      );
      return {
        notificationsSent: 0,
        notificationsFailed: 0,
        averageProcessingTime: 0,
        successRate: 0,
        channelBreakdown: {},
        priorityBreakdown: {},
      };
    }
  }

  recordChannelDelivery(
    channel: string,
    success: boolean,
    duration: number,
  ): void {
    try {
      this.logger.debug(
        `Channel delivery: ${channel}, success: ${success}, duration: ${duration}ms`,
      );

      // Record channel stats
      const channelStats = this.metrics.channelStats.get(channel) || {
        sent: 0,
        failed: 0,
      };

      if (success) {
        channelStats.sent++;
      } else {
        channelStats.failed++;
      }

      this.metrics.channelStats.set(channel, channelStats);

      // Record processing time if successful
      if (success) {
        this.metrics.processingTimes.push(duration);
        // Keep only last 1000 processing times to avoid memory issues
        if (this.metrics.processingTimes.length > 1000) {
          this.metrics.processingTimes =
            this.metrics.processingTimes.slice(-1000);
        }
      }
    } catch (error) {
      this.logger.error(
        'Failed to record channel delivery metric',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  resetMetrics(): void {
    try {
      this.metrics.sent.clear();
      this.metrics.failed.clear();
      this.metrics.processingTimes = [];
      this.metrics.channelStats.clear();
      this.metrics.priorityStats.clear();

      this.logger.log('Metrics reset successfully');
    } catch (error) {
      this.logger.error(
        'Failed to reset metrics',
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
