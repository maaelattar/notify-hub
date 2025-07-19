import { Injectable, Logger } from '@nestjs/common';
import { Notification } from '../../notifications/entities/notification.entity';
import { NotificationChannel } from '../../notifications/enums/notification-channel.enum';

export interface ChannelResult {
  success: boolean;
  messageId?: string;
  error?: string;
  details?: any;
}

@Injectable()
export class ChannelRouter {
  private readonly logger = new Logger(ChannelRouter.name);

  async route(notification: Notification): Promise<ChannelResult> {
    this.logger.log(
      `Routing notification ${notification.id} to ${notification.channel}`,
    );

    try {
      switch (notification.channel) {
        case NotificationChannel.EMAIL:
          return await this.sendEmail(notification);

        case NotificationChannel.SMS:
          return await this.sendSMS(notification);

        case NotificationChannel.PUSH:
          return await this.sendPushNotification(notification);

        case NotificationChannel.WEBHOOK:
          return await this.sendWebhook(notification);

        default:
          return {
            success: false,
            error: `Unknown channel: ${String(notification.channel)}`,
          };
      }
    } catch (error) {
      this.logger.error(
        'Channel routing failed',
        error instanceof Error ? error.stack : error,
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async sendEmail(notification: Notification): Promise<ChannelResult> {
    // Temporary mock implementation
    this.logger.log(`Mock sending email to ${notification.recipient}`);

    // Simulate network delay
    await new Promise((resolve) =>
      setTimeout(resolve, 100 + Math.random() * 200),
    );

    // Simulate 90% success rate for testing
    if (Math.random() > 0.9) {
      return {
        success: false,
        error: 'Mock email service error - simulated failure',
      };
    }

    return {
      success: true,
      messageId: `mock-email-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      details: {
        provider: 'mock-email-provider',
        processingTime: Date.now(),
      },
    };
  }

  private async sendSMS(notification: Notification): Promise<ChannelResult> {
    // Temporary mock implementation
    this.logger.log(`Mock sending SMS to ${notification.recipient}`);

    // Simulate network delay
    await new Promise((resolve) =>
      setTimeout(resolve, 150 + Math.random() * 300),
    );

    // Simulate 85% success rate for testing (SMS typically has lower success rate)
    if (Math.random() > 0.85) {
      return {
        success: false,
        error: 'Mock SMS service error - invalid phone number or network issue',
      };
    }

    return {
      success: true,
      messageId: `mock-sms-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      details: {
        provider: 'mock-sms-provider',
        processingTime: Date.now(),
      },
    };
  }

  private async sendPushNotification(
    notification: Notification,
  ): Promise<ChannelResult> {
    // Temporary mock implementation
    this.logger.log(
      `Mock sending push notification to ${notification.recipient}`,
    );

    // Simulate network delay
    await new Promise((resolve) =>
      setTimeout(resolve, 80 + Math.random() * 120),
    );

    // Simulate 95% success rate for testing (push notifications usually reliable)
    if (Math.random() > 0.95) {
      return {
        success: false,
        error:
          'Mock push service error - device token invalid or app uninstalled',
      };
    }

    return {
      success: true,
      messageId: `mock-push-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      details: {
        provider: 'mock-push-provider',
        processingTime: Date.now(),
      },
    };
  }

  private async sendWebhook(
    notification: Notification,
  ): Promise<ChannelResult> {
    // Temporary mock implementation
    this.logger.log(`Mock sending webhook to ${notification.recipient}`);

    // Simulate network delay
    await new Promise((resolve) =>
      setTimeout(resolve, 200 + Math.random() * 500),
    );

    // Simulate 80% success rate for testing (webhooks can be unreliable)
    if (Math.random() > 0.8) {
      return {
        success: false,
        error: 'Mock webhook service error - endpoint unreachable or timeout',
      };
    }

    return {
      success: true,
      messageId: `mock-webhook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      details: {
        provider: 'mock-webhook-provider',
        processingTime: Date.now(),
      },
    };
  }
}
