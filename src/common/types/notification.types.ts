import { NotificationChannel } from '../../modules/notifications/enums/notification-channel.enum';
import { NotificationStatus } from '../../modules/notifications/enums/notification-status.enum';
import { NotificationPriority } from '../../modules/notifications/enums/notification-priority.enum';

/**
 * Strongly typed metadata interfaces to replace Record<string, any>
 */

export interface BaseNotificationMetadata {
  /** Template identifier used for this notification */
  templateId?: string;

  /** User identifier who triggered this notification */
  userId?: string;

  /** Campaign identifier for marketing notifications */
  campaignId?: string;

  /** Organization identifier for multi-tenant systems */
  organizationId?: string;

  /** Request identifier for correlation */
  requestId?: string;

  /** Source system that created this notification */
  source?: string;

  /** Priority override for this specific notification */
  priorityOverride?: NotificationPriority;

  /** Additional tags for categorization */
  tags?: string[];

  /** Custom tracking parameters */
  tracking?: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmTerm?: string;
    utmContent?: string;
  };
}

export interface EmailNotificationMetadata extends BaseNotificationMetadata {
  /** Email-specific metadata */
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];

  /** Email template variables */
  templateVariables?: Record<string, string | number | boolean>;

  /** Attachment information */
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
    url?: string;
  }>;

  /** Email delivery options */
  deliveryOptions?: {
    sendAt?: string; // ISO date string
    timezone?: string;
    retryCount?: number;
  };
}

export interface SmsNotificationMetadata extends BaseNotificationMetadata {
  /** SMS-specific metadata */
  fromNumber?: string;
  countryCode?: string;

  /** SMS delivery options */
  deliveryOptions?: {
    sendAt?: string; // ISO date string
    timezone?: string;
    shortUrlDomain?: string;
  };
}

export interface WebhookNotificationMetadata extends BaseNotificationMetadata {
  /** Webhook-specific metadata */
  headers?: Record<string, string>;
  method?: 'POST' | 'PUT' | 'PATCH';
  timeout?: number;
  retryCount?: number;

  /** Webhook security */
  signatureHeader?: string;
  secretKey?: string;

  /** Webhook delivery options */
  deliveryOptions?: {
    sendAt?: string; // ISO date string
    followRedirects?: boolean;
    verifySSL?: boolean;
  };
}

export interface PushNotificationMetadata extends BaseNotificationMetadata {
  /** Push notification specific metadata */
  badge?: number;
  sound?: string;
  category?: string;
  threadId?: string;

  /** Platform-specific data */
  ios?: {
    alert?: {
      title?: string;
      subtitle?: string;
      body?: string;
    };
    sound?: string;
    badge?: number;
    category?: string;
    threadId?: string;
    mutableContent?: boolean;
    contentAvailable?: boolean;
  };

  android?: {
    title?: string;
    body?: string;
    icon?: string;
    color?: string;
    sound?: string;
    tag?: string;
    clickAction?: string;
    bodyLocKey?: string;
    bodyLocArgs?: string[];
    titleLocKey?: string;
    titleLocArgs?: string[];
  };

  web?: {
    title?: string;
    body?: string;
    icon?: string;
    badge?: string;
    image?: string;
    actions?: Array<{
      action: string;
      title: string;
      icon?: string;
    }>;
  };
}

/**
 * Union type for all notification metadata types
 */
export type NotificationMetadata =
  | EmailNotificationMetadata
  | SmsNotificationMetadata
  | WebhookNotificationMetadata
  | PushNotificationMetadata
  | BaseNotificationMetadata;

/**
 * Type-safe metadata getter based on channel
 */
export type MetadataForChannel<T extends NotificationChannel> =
  T extends NotificationChannel.EMAIL
    ? EmailNotificationMetadata
    : T extends NotificationChannel.SMS
      ? SmsNotificationMetadata
      : T extends NotificationChannel.WEBHOOK
        ? WebhookNotificationMetadata
        : T extends NotificationChannel.PUSH
          ? PushNotificationMetadata
          : BaseNotificationMetadata;

/**
 * Error context types to replace any usage in error handling
 */
export interface ValidationErrorContext {
  field: string;
  value: unknown;
  expectedType?: string;
  channel?: NotificationChannel;
  currentLength?: number;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
}

export interface SecurityErrorContext {
  ipAddress: string;
  userAgent: string;
  requestId: string;
  endpoint: string;
  apiKeyId?: string;
  organizationId?: string;
  reason: string;
  timestamp: Date;
}

export interface BusinessErrorContext {
  entityId: string;
  entityType: string;
  currentStatus?: NotificationStatus;
  requestedAction: string;
  reason: string;
  allowedActions?: string[];
}

export interface SystemErrorContext {
  component: string;
  operation: string;
  correlationId: string;
  timestamp: Date;
  errorCode?: string;
  stackTrace?: string;
  additionalData?: Record<string, unknown>;
}

/**
 * Configuration types for type-safe config access
 */
export interface NotificationConfiguration {
  maxRetries: number;
  defaultPageSize: number;
  maxPageSize: number;
  recentFailuresWindowMinutes: number;
  pendingNotificationsBatchSize: number;
  maxRecentFailuresDisplay: number;
  defaultPriority: NotificationPriority;
  enableScheduling: boolean;
  enableBatching: boolean;
  batchSize: number;
  batchTimeoutMs: number;
}

export interface SecurityConfiguration {
  apiKeyHashRounds: number;
  maxApiKeysPerOrganization: number;
  apiKeyExpirationDays: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  enableIpWhitelisting: boolean;
  enableGeoblocking: boolean;
  blockedCountries: string[];
  auditLogRetentionDays: number;
}

/**
 * Event types for future event-driven architecture
 */
export interface NotificationEvent {
  id: string;
  type: string;
  aggregateId: string;
  aggregateType: string;
  version: number;
  data: Record<string, unknown>;
  metadata: {
    correlationId: string;
    causationId?: string;
    userId?: string;
    timestamp: Date;
  };
}
