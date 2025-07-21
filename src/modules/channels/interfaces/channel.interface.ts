import { Notification } from '../../notifications/entities/notification.entity';
import { NotificationChannel } from '../../notifications/enums/notification-channel.enum';

export interface ChannelResult {
  success: boolean;
  channel: NotificationChannel;
  messageId?: string;
  error?: string;
  details?: Record<string, unknown>;
  deliveredAt?: Date;
}

export interface INotificationChannel {
  name: NotificationChannel;
  send(notification: Notification): Promise<ChannelResult>;
  isAvailable(): Promise<boolean>;
  validateRecipient(recipient: string): boolean;
}

export interface ChannelConfig {
  enabled: boolean;
  rateLimit?: {
    maxRequests: number;
    windowMs: number;
  };
  retry?: {
    maxAttempts: number;
    backoffMs: number;
  };
}
