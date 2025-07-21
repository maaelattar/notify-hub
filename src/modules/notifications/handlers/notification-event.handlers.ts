import { Injectable, Logger } from '@nestjs/common';
import { EventHandler } from '../../../common/events/domain-events';
import {
  NotificationCreatedEvent,
  NotificationSentEvent,
  NotificationFailedEvent,
  NotificationDeliveredEvent,
  NotificationCancelledEvent,
} from '../../../common/events/domain-events';
import { RedisMetricsService } from '../../common/services/redis-metrics.service';

/**
 * Event handler for notification analytics and metrics
 * Tracks notification events for real-time analytics
 */
@Injectable()
export class NotificationAnalyticsHandler
  implements
    EventHandler<
      | NotificationCreatedEvent
      | NotificationSentEvent
      | NotificationFailedEvent
      | NotificationDeliveredEvent
    >
{
  readonly eventType = 'NotificationCreated' as const;
  private readonly logger = new Logger(NotificationAnalyticsHandler.name);

  constructor(private readonly metricsService: RedisMetricsService) {}

  async handle(
    event:
      | NotificationCreatedEvent
      | NotificationSentEvent
      | NotificationFailedEvent
      | NotificationDeliveredEvent,
  ): Promise<void> {
    try {
      switch (event.eventType) {
        case 'NotificationCreated':
          await this.handleNotificationCreated(event);
          break;
        case 'NotificationSent':
          await this.handleNotificationSent(event);
          break;
        case 'NotificationFailed':
          await this.handleNotificationFailed(event);
          break;
        case 'NotificationDelivered':
          await this.handleNotificationDelivered(event);
          break;
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle notification analytics event: ${event.eventType}`,
        {
          eventId: event.eventId,
          aggregateId: event.aggregateId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );
    }
  }

  private async handleNotificationCreated(
    event: NotificationCreatedEvent,
  ): Promise<void> {
    const { payload } = event;

    // Increment creation metrics
    await Promise.all([
      this.metricsService.incrementCounter('notifications.created.total'),
      this.metricsService.incrementCounter(
        `notifications.created.by_channel.${payload.channel}`,
      ),
      this.metricsService.incrementCounter(
        `notifications.created.by_priority.${payload.priority}`,
      ),
    ]);

    // Track hourly creation rate
    const hourKey = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    await this.metricsService.incrementCounter(
      `notifications.created.hourly.${hourKey}`,
    );

    this.logger.debug('Recorded notification creation metrics', {
      notificationId: payload.notificationId,
      channel: payload.channel,
      priority: payload.priority,
    });
  }

  private async handleNotificationSent(
    event: NotificationSentEvent,
  ): Promise<void> {
    const { payload } = event;

    // Increment sent metrics
    await Promise.all([
      this.metricsService.incrementCounter('notifications.sent.total'),
      this.metricsService.incrementCounter(
        `notifications.sent.by_channel.${payload.channel}`,
      ),
      this.metricsService.recordValue(
        'notifications.delivery_time',
        payload.deliveryTime,
      ),
    ]);

    this.logger.debug('Recorded notification sent metrics', {
      notificationId: payload.notificationId,
      channel: payload.channel,
      deliveryTime: payload.deliveryTime,
    });
  }

  private async handleNotificationFailed(
    event: NotificationFailedEvent,
  ): Promise<void> {
    const { payload } = event;

    // Increment failure metrics
    await Promise.all([
      this.metricsService.incrementCounter('notifications.failed.total'),
      this.metricsService.incrementCounter(
        `notifications.failed.by_channel.${payload.channel}`,
      ),
      this.metricsService.incrementCounter(
        `notifications.failed.by_error.${payload.error.code}`,
      ),
    ]);

    // Track retry metrics
    if (payload.willRetry) {
      await this.metricsService.incrementCounter(
        'notifications.retries.scheduled',
      );
    } else {
      await this.metricsService.incrementCounter(
        'notifications.retries.exhausted',
      );
    }

    this.logger.debug('Recorded notification failure metrics', {
      notificationId: payload.notificationId,
      channel: payload.channel,
      errorCode: payload.error.code,
      retryCount: payload.retryCount,
      willRetry: payload.willRetry,
    });
  }

  private async handleNotificationDelivered(
    event: NotificationDeliveredEvent,
  ): Promise<void> {
    const { payload } = event;

    // Increment delivery metrics
    await Promise.all([
      this.metricsService.incrementCounter('notifications.delivered.total'),
      this.metricsService.incrementCounter(
        `notifications.delivered.by_channel.${payload.channel}`,
      ),
      this.metricsService.recordValue(
        'notifications.total_delivery_time',
        payload.totalDeliveryTime,
      ),
    ]);

    this.logger.debug('Recorded notification delivery metrics', {
      notificationId: payload.notificationId,
      channel: payload.channel,
      totalDeliveryTime: payload.totalDeliveryTime,
    });
  }
}

/**
 * Event handler for notification audit logging
 * Maintains detailed audit trail of all notification events
 */
@Injectable()
export class NotificationAuditHandler implements EventHandler {
  readonly eventType = 'NotificationCreated' as const;
  private readonly logger = new Logger(NotificationAuditHandler.name);

  async handle(event: any): Promise<void> {
    try {
      // Create structured audit log entry
      const auditEntry = {
        eventId: event.eventId,
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        aggregateType: event.aggregateType,
        occurredAt: event.occurredAt,
        correlationId: event.correlationId,
        userId: event.metadata.userId,
        organizationId: event.metadata.organizationId,
        payload: this.sanitizePayload(event.payload),
      };

      // Log audit entry with structured format
      this.logger.log('Notification audit event', auditEntry);

      // In production, you might want to store this in a separate audit database
      // await this.auditRepository.save(auditEntry);
    } catch (error) {
      this.logger.error(
        `Failed to create audit log for event: ${event.eventType}`,
        {
          eventId: event.eventId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );
    }
  }

  private sanitizePayload(payload: any): any {
    if (!payload) return payload;

    const sanitized = { ...payload };

    // Remove or mask sensitive information
    if (sanitized.recipient) {
      sanitized.recipient = this.maskSensitiveData(sanitized.recipient);
    }

    if (sanitized.content && typeof sanitized.content === 'string') {
      // Truncate long content for audit logs
      sanitized.content =
        sanitized.content.length > 200
          ? sanitized.content.substring(0, 200) + '...'
          : sanitized.content;
    }

    return sanitized;
  }

  private maskSensitiveData(data: string): string {
    if (data.includes('@')) {
      // Email masking
      const [local, domain] = data.split('@');
      return `${local.charAt(0)}***@${domain}`;
    }

    if (data.startsWith('+') || /^\d+$/.test(data)) {
      // Phone masking
      return `${data.substring(0, 3)}***${data.substring(data.length - 2)}`;
    }

    // Generic masking
    return data.length > 6 ? `${data.substring(0, 3)}***` : '***';
  }
}

/**
 * Event handler for notification status caching
 * Maintains real-time cache of notification statuses for quick lookups
 */
@Injectable()
export class NotificationCacheHandler implements EventHandler {
  readonly eventType = 'NotificationCreated' as const;
  private readonly logger = new Logger(NotificationCacheHandler.name);

  constructor(private readonly metricsService: RedisMetricsService) {}

  async handle(event: any): Promise<void> {
    try {
      const cacheKey = `notification:${event.aggregateId}:status`;
      const statusData = {
        id: event.aggregateId,
        status: this.extractStatusFromEvent(event),
        channel: event.payload?.channel,
        updatedAt: event.occurredAt,
        eventType: event.eventType,
      };

      // Cache the status with expiration (24 hours)
      await this.metricsService.setCache(cacheKey, statusData, 86400);

      this.logger.debug('Updated notification status cache', {
        notificationId: event.aggregateId,
        status: statusData.status,
        eventType: event.eventType,
      });
    } catch (error) {
      this.logger.error(
        `Failed to update notification cache for event: ${event.eventType}`,
        {
          eventId: event.eventId,
          aggregateId: event.aggregateId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );
    }
  }

  private extractStatusFromEvent(event: any): string {
    switch (event.eventType) {
      case 'NotificationCreated':
        return 'created';
      case 'NotificationQueued':
        return 'queued';
      case 'NotificationSent':
        return 'sent';
      case 'NotificationDelivered':
        return 'delivered';
      case 'NotificationFailed':
        return 'failed';
      case 'NotificationCancelled':
        return 'cancelled';
      case 'NotificationRetried':
        return 'queued'; // Reset to queued after retry
      default:
        return 'unknown';
    }
  }
}
