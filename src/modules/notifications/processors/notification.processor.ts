import {
  Process,
  Processor,
  OnQueueActive,
  OnQueueCompleted,
  OnQueueFailed,
} from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationRepository } from '../repositories/notification.repository';
import { NotificationStatus } from '../enums/notification-status.enum';
import { Notification } from '../entities/notification.entity';
import { NotificationConfig } from '../config/notification.config';
import { NotificationJobData } from '../services/notification.producer';
import { ChannelRouter } from '../../channels/services/channel-router.service';
import { ChannelResult } from '../../channels/interfaces/channel.interface';
import { MetricsService } from '../../common/services/metrics.service';

@Processor('notifications')
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);
  private readonly config: NotificationConfig;

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly configService: ConfigService,
    private readonly channelRouter: ChannelRouter,
    private readonly metricsService: MetricsService,
  ) {
    this.config = this.configService.get<NotificationConfig>('notification')!;
  }

  @Process('process-notification')
  async handleNotification(job: Job<NotificationJobData>) {
    const startTime = Date.now();
    const { notificationId, priority, attempt = 1 } = job.data;

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

    this.logger.log(
      `Processing notification ${notificationId} (Job ${job.id}, Attempt ${attempt}/${job.opts.attempts})`,
    );

    let notification: Notification | null = null;

    try {
      // 1. Fetch notification
      notification = await this.notificationRepository.findById(notificationId);

      if (!notification) {
        throw new Error(`Notification ${notificationId} not found`);
      }

      // 2. Check if already processed
      if (
        notification.status === NotificationStatus.SENT ||
        notification.status === NotificationStatus.DELIVERED
      ) {
        this.logger.warn(`Notification ${notificationId} already processed`);
        return { success: true, alreadyProcessed: true };
      }

      // 3. Update status to processing
      await this.notificationRepository.updateStatus(
        notificationId,
        NotificationStatus.PROCESSING,
      );

      // 4. Route to appropriate channel
      this.logger.log(
        `Routing ${notificationId} to ${notification.channel} channel`,
      );
      const result: ChannelResult =
        await this.channelRouter.route(notification);

      // 5. Update status based on result
      if (result.success) {
        await this.notificationRepository.update(notificationId, {
          status: NotificationStatus.SENT,
          sentAt: new Date(),
          metadata: {
            ...notification.metadata,
            delivery: {
              messageId: result.messageId,
              channel: result.channel,
              deliveredAt: result.deliveredAt,
              details: result.details,
            } as any,
            processingTime: Date.now() - startTime,
            attempts: attempt,
          },
        });

        this.logger.log(
          `Successfully sent notification ${notificationId} via ${notification.channel}`,
        );

        // Track metrics
        this.metricsService.recordNotificationSent(
          notification.channel,
          priority,
          Date.now() - startTime,
        );

        return {
          success: true,
          messageId: result.messageId,
          channel: result.channel,
          processingTime: Date.now() - startTime,
        };
      } else {
        throw new Error(result.error || 'Channel delivery failed');
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to process notification ${notificationId}`,
        error instanceof Error ? error.stack : error,
      );

      // Update notification with error
      if (notification) {
        await this.notificationRepository.update(notificationId, {
          lastError: errorMessage,
          retryCount: attempt,
        });
      }

      // Check if this is the last attempt
      if (attempt >= (job.opts.attempts || 3)) {
        if (notification) {
          await this.notificationRepository.updateStatus(
            notificationId,
            NotificationStatus.FAILED,
          );
        }

        // Track failed metric
        this.metricsService.recordNotificationFailed(
          priority,
          errorMessage,
          notification?.channel,
        );
      }

      // Re-throw to trigger Bull's retry mechanism
      throw error;
    }
  }

  /**
   * Job lifecycle hooks for monitoring
   */
  @OnQueueActive()
  onActive(job: Job<NotificationJobData>) {
    this.logger.debug(`Job ${job.id} started: ${job.data.notificationId}`);
  }

  @OnQueueCompleted()
  onComplete(
    job: Job<NotificationJobData>,
    result: { processingTime?: number },
  ) {
    this.logger.log(
      `Job ${job.id} completed: ${job.data.notificationId} ${result.processingTime ? `in ${result.processingTime}ms` : ''}`,
    );
  }

  @OnQueueFailed()
  onError(job: Job<NotificationJobData>, error: Error) {
    this.logger.error(
      `Job ${job.id} failed: ${job.data.notificationId}`,
      error.stack,
    );

    // Additional error handling
    void this.handleJobFailure(job, error);
  }

  /**
   * Handle job failures
   */
  private handleJobFailure(job: Job<NotificationJobData>, error: Error): void {
    const { notificationId, attempt = 1 } = job.data;

    // Log to external error tracking (e.g., Sentry)
    this.logger.error({
      message: 'Notification processing failed',
      notificationId,
      jobId: job.id,
      attempt,
      error: error.message,
      stack: error.stack,
    });

    // Special handling for specific errors
    if (error.message.includes('Rate limit')) {
      // Log rate limit error for manual intervention
      this.logger.warn(
        `Job ${job.id} failed due to rate limit - requires manual intervention`,
      );
    }
  }

  private validateJobData(data: unknown): data is NotificationJobData {
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

    // Validate priority if present
    if (jobData.priority && typeof jobData.priority !== 'string') {
      return false;
    }

    return true;
  }
}
