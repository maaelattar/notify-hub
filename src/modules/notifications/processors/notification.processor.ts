import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationRepository } from '../repositories/notification.repository';
import { NotificationStatus } from '../enums/notification-status.enum';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { Notification } from '../entities/notification.entity';
import { NotificationConfig } from '../config/notification.config';

@Processor('notifications')
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);
  private readonly config: NotificationConfig;

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly configService: ConfigService,
  ) {
    this.config = this.configService.get<NotificationConfig>('notification')!;
  }

  @Process('process-notification')
  async handleNotification(job: Job<{ notificationId: string }>) {
    // Validate job data
    if (!this.validateJobData(job.data)) {
      const error = new Error(
        'Invalid job data: missing or invalid notificationId',
      );
      this.logger.error(
        `Job ${job.id} has invalid data: ${JSON.stringify(job.data)}`,
      );
      throw error;
    }

    const { notificationId } = job.data;
    this.logger.log(`Processing notification ${notificationId}`);

    let notification: Notification | null = null;

    try {
      // Get notification and update to processing
      notification = await this.notificationRepository.findById(notificationId);
      if (!notification) {
        const error = new Error(
          `Notification not found during queue processing: ${notificationId}`,
        );
        this.logger.error('Queue processing failed: notification not found', {
          notificationId,
          jobId: job.id,
        });
        throw error;
      }

      await this.notificationRepository.updateStatus(
        notificationId,
        NotificationStatus.PROCESSING,
      );

      // Send the notification
      await this.sendNotification(notification);

      // Mark as sent
      await this.notificationRepository.updateStatus(
        notificationId,
        NotificationStatus.SENT,
      );

      this.logger.log(`Successfully sent notification ${notificationId}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to process notification', {
        notificationId,
        jobId: job.id,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts,
        error: errorMessage,
        channel: notification?.channel,
        recipient: notification?.recipient,
      });

      if (notification) {
        // Check if we can retry
        const canRetry = notification.retryCount < this.config.maxRetries - 1;

        if (canRetry) {
          // Update retry count and error, but let Bull handle the retry
          await this.notificationRepository.update(notificationId, {
            retryCount: notification.retryCount + 1,
            lastError: errorMessage,
          });

          this.logger.warn('Notification will be retried', {
            notificationId,
            currentAttempt: notification.retryCount + 2,
            maxAttempts: this.config.maxRetries,
            channel: notification.channel,
            nextRetryDelay: job.opts.backoff,
          });
        } else {
          // Mark as permanently failed
          await this.notificationRepository.update(notificationId, {
            status: NotificationStatus.FAILED,
            lastError: errorMessage,
            retryCount: notification.retryCount + 1,
          });

          this.logger.error('Notification permanently failed', {
            notificationId,
            totalAttempts: this.config.maxRetries,
            channel: notification.channel,
            recipient: notification.recipient,
            finalError: errorMessage,
          });
        }
      }

      throw error; // Re-throw to trigger Bull retry mechanism
    }
  }

  private async sendNotification(notification: Notification): Promise<void> {
    // Simulate different processing times and failure rates by channel
    const delay = Math.random() * 1000 + 500; // 0.5-1.5 seconds
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Simulate occasional failures for testing
    if (Math.random() < 0.1) {
      // 10% failure rate
      throw new Error(`Simulated ${notification.channel} delivery failure`);
    }

    switch (notification.channel) {
      case NotificationChannel.EMAIL:
        this.sendEmail(notification);
        break;
      case NotificationChannel.SMS:
        this.sendSMS(notification);
        break;
      case NotificationChannel.PUSH:
        this.sendPushNotification(notification);
        break;
      case NotificationChannel.WEBHOOK:
        this.sendWebhook(notification);
        break;
      default:
        throw new Error(
          `Unsupported notification channel: ${String(notification.channel)}`,
        );
    }
  }

  private sendEmail(notification: Notification): void {
    // TODO: Integrate with email service (SendGrid, SES, etc.)
    this.logger.log(
      `[EMAIL] Sending to ${notification.recipient}: ${notification.subject}`,
    );
    // Placeholder - would integrate with actual email service
  }

  private sendSMS(notification: Notification): void {
    // TODO: Integrate with SMS service (Twilio, AWS SNS, etc.)
    this.logger.log(
      `[SMS] Sending to ${notification.recipient}: ${notification.content.substring(0, 50)}...`,
    );
    // Placeholder - would integrate with actual SMS service
  }

  private sendPushNotification(notification: Notification): void {
    // TODO: Integrate with push service (FCM, APNS, etc.)
    this.logger.log(
      `[PUSH] Sending to ${notification.recipient}: ${notification.content.substring(0, 50)}...`,
    );
    // Placeholder - would integrate with actual push service
  }

  private sendWebhook(notification: Notification): void {
    // TODO: Make HTTP request to webhook URL
    this.logger.log(`[WEBHOOK] Sending to ${notification.recipient}`);
    // Placeholder - would make actual HTTP request
  }

  private validateJobData(data: unknown): data is { notificationId: string } {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const jobData = data as Record<string, unknown>;
    if (!jobData.notificationId || typeof jobData.notificationId !== 'string') {
      return false;
    }

    // Validate UUID format (basic check)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(jobData.notificationId)) {
      return false;
    }

    return true;
  }
}
