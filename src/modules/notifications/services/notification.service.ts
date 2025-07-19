import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { DataSource } from 'typeorm';
import { NotificationRepository } from '../repositories/notification.repository';
import { CreateNotificationDto } from '../dto/create-notification.dto';
import { UpdateNotificationDto } from '../dto/update-notification.dto';
import { NotificationResponseDto } from '../dto/notification-response.dto';
import { NotificationFilterDto } from '../dto/notification-filter.dto';
import { PaginatedResponseDto } from '../dto/paginated-response.dto';
import { Notification } from '../entities/notification.entity';
import { NotificationStatus } from '../enums/notification-status.enum';
import { NotificationConfig } from '../config/notification.config';

interface NotificationJobData {
  notificationId: string;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly config: NotificationConfig;

  constructor(
    private readonly notificationRepository: NotificationRepository,
    @InjectQueue('notifications')
    private readonly notificationQueue: Queue<NotificationJobData>,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {
    this.config = this.configService.get<NotificationConfig>('notification')!;
  }

  async create(dto: CreateNotificationDto): Promise<NotificationResponseDto> {
    this.logger.log(
      `Creating notification for ${dto.recipient} via ${dto.channel}`,
    );

    // Custom validation
    const validationErrors = dto.validate();
    if (validationErrors.length > 0) {
      this.logger.warn(`Validation failed for notification creation`, {
        recipient: dto.recipient,
        channel: dto.channel,
        errors: validationErrors,
      });
      throw new BadRequestException({
        message: 'Notification validation failed',
        errors: validationErrors,
        context: {
          channel: dto.channel,
          recipient: dto.recipient,
        },
      });
    }

    return await this.dataSource.transaction(async (manager) => {
      // Create notification entity within transaction
      const notificationRepo = manager.getRepository(Notification);
      const notification = await notificationRepo.save({
        channel: dto.channel,
        recipient: dto.recipient,
        subject: dto.subject,
        content: dto.content,
        metadata: dto.metadata || {},
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
        status: NotificationStatus.CREATED,
      });

      // Queue for processing
      const delay = this.calculateDelay(notification.scheduledFor);
      await this.queueNotification(notification.id, delay);

      this.logger.log(`Notification ${notification.id} created and queued`);
      return NotificationResponseDto.fromEntity(notification);
    });
  }

  async findOne(id: string): Promise<NotificationResponseDto> {
    const notification = await this.notificationRepository.findById(id);

    if (!notification) {
      this.logger.warn(`Attempted to access non-existent notification`, { id });
      throw new NotFoundException({
        message: `Notification not found`,
        context: { notificationId: id },
      });
    }

    return NotificationResponseDto.fromEntity(notification);
  }

  async findAll(
    filters: NotificationFilterDto,
  ): Promise<PaginatedResponseDto<NotificationResponseDto>> {
    const page = filters.page || 1;
    const limit = Math.min(
      filters.limit || this.config.defaultPageSize,
      this.config.maxPageSize,
    );

    const result = await this.notificationRepository.findAll(
      {
        status: filters.status,
        channel: filters.channel,
        recipient: filters.recipient,
      },
      { page, limit },
    );

    const notificationDtos = result.data.map((n) =>
      NotificationResponseDto.fromEntity(n),
    );

    return PaginatedResponseDto.create(
      notificationDtos,
      result.total,
      result.page,
      result.limit,
    );
  }

  async update(
    id: string,
    dto: UpdateNotificationDto,
  ): Promise<NotificationResponseDto> {
    const notification = await this.notificationRepository.findById(id);

    if (!notification) {
      this.logger.warn(`Attempted to update non-existent notification`, { id });
      throw new NotFoundException({
        message: `Notification not found`,
        context: { notificationId: id },
      });
    }

    // Business rule: Can't update sent notifications
    if (
      notification.status === NotificationStatus.SENT ||
      notification.status === NotificationStatus.DELIVERED
    ) {
      this.logger.warn(`Attempted to update notification in final state`, {
        notificationId: id,
        currentStatus: notification.status,
        channel: notification.channel,
      });
      throw new BadRequestException({
        message: 'Cannot update notifications that have been sent or delivered',
        context: {
          notificationId: id,
          currentStatus: notification.status,
          channel: notification.channel,
        },
      });
    }

    // Build update object, excluding undefined values
    const updateData: Partial<Notification> = {};
    if (dto.subject !== undefined) updateData.subject = dto.subject;
    if (dto.content !== undefined) updateData.content = dto.content;
    if (dto.metadata !== undefined) updateData.metadata = dto.metadata;
    if (dto.scheduledFor !== undefined) {
      updateData.scheduledFor = dto.scheduledFor
        ? new Date(dto.scheduledFor)
        : null;
    }
    if (dto.status !== undefined) updateData.status = dto.status;

    return await this.dataSource.transaction(async (manager) => {
      // Apply updates within transaction
      const notificationRepo = manager.getRepository(Notification);
      await notificationRepo.update(id, updateData);
      const updated = await notificationRepo.findOne({ where: { id } });

      if (!updated) {
        throw new Error('Failed to retrieve updated notification');
      }

      // Re-queue if schedule changed (outside transaction)
      if (
        dto.scheduledFor !== undefined &&
        notification.scheduledFor?.getTime() !== updated.scheduledFor?.getTime()
      ) {
        await this.requeueNotification(updated.id, updated.scheduledFor);
      }

      this.logger.log(`Notification ${id} updated`);
      return NotificationResponseDto.fromEntity(updated);
    });
  }

  async cancel(id: string): Promise<NotificationResponseDto> {
    const notification = await this.notificationRepository.findById(id);

    if (!notification) {
      this.logger.warn(`Attempted to cancel non-existent notification`, { id });
      throw new NotFoundException({
        message: `Notification not found`,
        context: { notificationId: id },
      });
    }

    // Use entity method for business logic
    try {
      notification.markAsCancelled();
    } catch (error) {
      this.logger.warn(`Failed to cancel notification due to business rule`, {
        notificationId: id,
        currentStatus: notification.status,
        channel: notification.channel,
        error: (error as Error).message,
      });
      throw new BadRequestException({
        message: 'Cannot cancel notification in current state',
        context: {
          notificationId: id,
          currentStatus: notification.status,
          channel: notification.channel,
          reason: (error as Error).message,
        },
      });
    }

    return await this.dataSource.transaction(async (manager) => {
      // Update notification status within transaction
      const notificationRepo = manager.getRepository(Notification);
      await notificationRepo.update(id, {
        status: notification.status,
      });

      // Remove from queue (outside transaction but after DB commit)
      try {
        const job = await this.notificationQueue.getJob(id);
        if (job) {
          await job.remove();
          this.logger.debug(`Removed job ${job.id} for notification ${id}`);
        }
      } catch {
        // Job might not exist or already processed, which is fine
        this.logger.debug(
          `Could not remove job for notification ${id}: job may not exist`,
        );
      }

      this.logger.log(`Notification ${id} cancelled`);
      return NotificationResponseDto.fromEntity(notification);
    });
  }

  async retry(id: string): Promise<NotificationResponseDto> {
    const notification = await this.notificationRepository.findById(id);

    if (!notification) {
      this.logger.warn(`Attempted to retry non-existent notification`, { id });
      throw new NotFoundException({
        message: `Notification not found`,
        context: { notificationId: id },
      });
    }

    if (!notification.canRetry()) {
      this.logger.warn(
        `Attempted to retry notification that cannot be retried`,
        {
          notificationId: id,
          currentStatus: notification.status,
          retryCount: notification.retryCount,
          maxRetries: this.config.maxRetries,
        },
      );
      throw new BadRequestException({
        message: 'Notification cannot be retried',
        context: {
          notificationId: id,
          currentStatus: notification.status,
          retryCount: notification.retryCount,
          maxRetries: this.config.maxRetries,
        },
      });
    }

    // Reset status and queue again
    notification.status = NotificationStatus.CREATED;
    await this.notificationRepository.update(id, {
      status: notification.status,
    });
    await this.queueNotification(id, 0);

    this.logger.log(`Notification ${id} queued for retry`);
    return NotificationResponseDto.fromEntity(notification);
  }

  async getStats(): Promise<{
    statusCounts: Record<NotificationStatus, number>;
    recentFailureCount: number;
    recentFailures: Array<{
      id: string;
      channel: string;
      error: string | null;
      failedAt: Date;
    }>;
  }> {
    const statusCounts = await this.notificationRepository.getStatusCounts();
    const recentFailures = await this.notificationRepository.getRecentFailures(
      this.config.recentFailuresWindowMinutes,
      this.config.maxRecentFailuresDisplay,
    );

    return {
      statusCounts,
      recentFailureCount: recentFailures.length,
      recentFailures: recentFailures.map((n) => ({
        id: n.id,
        channel: n.channel,
        error: n.lastError,
        failedAt: n.updatedAt,
      })),
    };
  }

  // Internal methods
  private async queueNotification(
    notificationId: string,
    delay: number,
  ): Promise<void> {
    // Use notification ID as job ID for easy lookup
    const job = await this.notificationQueue.add(
      'process-notification',
      { notificationId },
      {
        jobId: notificationId, // Use notification ID as job ID
        delay,
        attempts: this.config.maxRetries,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.debug(
      `Job ${job.id} created for notification ${notificationId}`,
    );

    // Update status to queued
    await this.notificationRepository.updateStatus(
      notificationId,
      NotificationStatus.QUEUED,
    );
  }

  private async requeueNotification(
    notificationId: string,
    scheduledFor: Date | null,
  ): Promise<void> {
    // Remove existing job using job ID
    try {
      const existingJob = await this.notificationQueue.getJob(notificationId);
      if (existingJob) {
        await existingJob.remove();
        this.logger.debug(
          `Removed existing job for notification ${notificationId}`,
        );
      }
    } catch {
      // Job might not exist, which is fine
      this.logger.debug(
        `No existing job found for notification ${notificationId}`,
      );
    }

    // Add new job with updated delay
    const delay = this.calculateDelay(scheduledFor);
    await this.queueNotification(notificationId, delay);
  }

  private calculateDelay(scheduledFor: Date | null): number {
    if (!scheduledFor) {
      return 0;
    }

    const delay = scheduledFor.getTime() - Date.now();
    return delay > 0 ? delay : 0;
  }
}
