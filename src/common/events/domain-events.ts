import { NotificationChannel } from '../../modules/notifications/enums/notification-channel.enum';
import { NotificationPriority } from '../../modules/notifications/enums/notification-priority.enum';

/**
 * Base domain event interface
 * All domain events should extend this interface
 */
export interface DomainEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly version: number;
  readonly occurredAt: Date;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly metadata: {
    userId?: string;
    organizationId?: string;
    source: string;
    [key: string]: any;
  };
}

/**
 * Notification domain events
 */
export interface NotificationCreatedEvent extends DomainEvent {
  eventType: 'NotificationCreated';
  aggregateType: 'Notification';
  payload: {
    notificationId: string;
    channel: NotificationChannel;
    recipient: string;
    subject?: string;
    content: string;
    priority: NotificationPriority;
    scheduledFor?: Date;
    metadata: Record<string, any>;
  };
}

export interface NotificationQueuedEvent extends DomainEvent {
  eventType: 'NotificationQueued';
  aggregateType: 'Notification';
  payload: {
    notificationId: string;
    channel: NotificationChannel;
    priority: NotificationPriority;
    queuedAt: Date;
    estimatedDeliveryTime?: Date;
  };
}

export interface NotificationSentEvent extends DomainEvent {
  eventType: 'NotificationSent';
  aggregateType: 'Notification';
  payload: {
    notificationId: string;
    channel: NotificationChannel;
    recipient: string;
    sentAt: Date;
    deliveryTime: number; // milliseconds
    messageId?: string;
    provider?: string;
  };
}

export interface NotificationDeliveredEvent extends DomainEvent {
  eventType: 'NotificationDelivered';
  aggregateType: 'Notification';
  payload: {
    notificationId: string;
    channel: NotificationChannel;
    recipient: string;
    deliveredAt: Date;
    totalDeliveryTime: number; // milliseconds from creation
    confirmationId?: string;
  };
}

export interface NotificationFailedEvent extends DomainEvent {
  eventType: 'NotificationFailed';
  aggregateType: 'Notification';
  payload: {
    notificationId: string;
    channel: NotificationChannel;
    recipient: string;
    failedAt: Date;
    error: {
      code: string;
      message: string;
      details?: unknown;
    };
    retryCount: number;
    willRetry: boolean;
    nextRetryAt?: Date;
  };
}

export interface NotificationCancelledEvent extends DomainEvent {
  eventType: 'NotificationCancelled';
  aggregateType: 'Notification';
  payload: {
    notificationId: string;
    channel: NotificationChannel;
    cancelledAt: Date;
    reason: string;
    cancelledBy?: string;
  };
}

export interface NotificationRetriedEvent extends DomainEvent {
  eventType: 'NotificationRetried';
  aggregateType: 'Notification';
  payload: {
    notificationId: string;
    channel: NotificationChannel;
    retriedAt: Date;
    retryCount: number;
    previousError?: string;
    triggeredBy?: string;
  };
}

export interface NotificationUpdatedEvent extends DomainEvent {
  eventType: 'NotificationUpdated';
  aggregateType: 'Notification';
  payload: {
    notificationId: string;
    updatedFields: string[];
    updatedAt: Date;
    updatedBy?: string;
    previousValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
  };
}

/**
 * System events
 */
export interface ChannelHealthChangedEvent extends DomainEvent {
  eventType: 'ChannelHealthChanged';
  aggregateType: 'Channel';
  payload: {
    channel: NotificationChannel;
    previousStatus: 'healthy' | 'degraded' | 'down';
    currentStatus: 'healthy' | 'degraded' | 'down';
    changedAt: Date;
    reason?: string;
    metrics?: {
      successRate: number;
      avgResponseTime: number;
      errorCount: number;
    };
  };
}

export interface RateLimitExceededEvent extends DomainEvent {
  eventType: 'RateLimitExceeded';
  aggregateType: 'RateLimit';
  payload: {
    apiKeyId?: string;
    ipAddress: string;
    endpoint: string;
    limit: number;
    current: number;
    windowMs: number;
    exceededAt: Date;
    userAgent?: string;
  };
}

export interface BulkOperationCompletedEvent extends DomainEvent {
  eventType: 'BulkOperationCompleted';
  aggregateType: 'BulkOperation';
  payload: {
    operationType: 'create' | 'update' | 'cancel' | 'retry';
    totalCount: number;
    successCount: number;
    failureCount: number;
    completedAt: Date;
    duration: number; // milliseconds
    errors?: Array<{
      entityId: string;
      error: string;
    }>;
  };
}

/**
 * Union type for all domain events
 */
export type AllDomainEvents =
  | NotificationCreatedEvent
  | NotificationQueuedEvent
  | NotificationSentEvent
  | NotificationDeliveredEvent
  | NotificationFailedEvent
  | NotificationCancelledEvent
  | NotificationRetriedEvent
  | NotificationUpdatedEvent
  | ChannelHealthChangedEvent
  | RateLimitExceededEvent
  | BulkOperationCompletedEvent;

/**
 * Event type mapping for type safety
 */
export type EventTypeMap = {
  NotificationCreated: NotificationCreatedEvent;
  NotificationQueued: NotificationQueuedEvent;
  NotificationSent: NotificationSentEvent;
  NotificationDelivered: NotificationDeliveredEvent;
  NotificationFailed: NotificationFailedEvent;
  NotificationCancelled: NotificationCancelledEvent;
  NotificationRetried: NotificationRetriedEvent;
  NotificationUpdated: NotificationUpdatedEvent;
  ChannelHealthChanged: ChannelHealthChangedEvent;
  RateLimitExceeded: RateLimitExceededEvent;
  BulkOperationCompleted: BulkOperationCompletedEvent;
};

/**
 * Event handler interface
 */
export interface EventHandler<T extends DomainEvent = DomainEvent> {
  readonly eventType: T['eventType'];
  handle(event: T): Promise<void> | void;
}

/**
 * Event publisher interface
 */
export interface EventPublisher {
  publish<T extends DomainEvent>(event: T): Promise<void>;
  publishMany<T extends DomainEvent>(events: T[]): Promise<void>;
}
