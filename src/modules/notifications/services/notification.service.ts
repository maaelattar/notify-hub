import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { NotificationRepository } from '../repositories/notification.repository';
import { CreateNotificationDto } from '../dto/create-notification.dto';
import { UpdateNotificationDto } from '../dto/update-notification.dto';
import { NotificationResponseDto } from '../dto/notification-response.dto';
import { NotificationFilterDto } from '../dto/notification-filter.dto';
import { PaginatedResponseDto } from '../dto/paginated-response.dto';
import { Notification } from '../entities/notification.entity';
import { NotificationStatus } from '../enums/notification-status.enum';
import { NotificationPriority } from '../enums/notification-priority.enum';
import { NotificationConfig } from '../config/notification.config';
import { NotificationProducer } from './notification.producer';
import { NotificationValidatorService } from './notification-validator.service';
import { Recipient } from '../value-objects/recipient.value-object';
import { NotificationContent } from '../value-objects/notification-content.value-object';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly config: NotificationConfig;

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly notificationProducer: NotificationProducer,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly validatorService: NotificationValidatorService,
  ) {
    this.config = this.configService.get<NotificationConfig>('notification')!;
  }

  async create(dto: CreateNotificationDto): Promise<NotificationResponseDto> {
    this.logger.log(
      `Creating notification for ${dto.recipient} via ${dto.channel}`,
    );

    // Comprehensive business validation
    const validationResult = await this.validatorService.validateWithCategories(dto);
    if (!validationResult.isValid) {
      this.logger.warn(`Validation failed for notification creation`, {
        recipient: dto.recipient,
        channel: dto.channel,
        criticalErrors: validationResult.criticalErrors.length,
        warningErrors: validationResult.warningErrors.length,
        errors: validationResult.allErrors,
      });
      
      throw new BadRequestException({
        message: 'Notification validation failed',
        errors: validationResult.allErrors.map(error => ({
          field: error.field,
          code: error.code,
          message: error.message,
          context: error.context,
        })),
        summary: {
          criticalErrors: validationResult.criticalErrors.length,
          warningErrors: validationResult.warningErrors.length,
          totalErrors: validationResult.allErrors.length,
        },
        context: {
          channel: dto.channel,
          recipient: dto.recipient,
        },
      });
    }

    return await this.dataSource.transaction(async (manager) => {
      // Create value objects with enhanced validation and business logic
      let recipientVO: Recipient | null = null;
      let contentVO: NotificationContent | null = null;

      try {
        // Create recipient value object with channel context
        recipientVO = Recipient.create(dto.recipient, dto.channel);
        
        // Create content value object with channel-specific format detection
        contentVO = NotificationContent.create(dto.content, dto.channel);
      } catch (error) {
        this.logger.warn('Failed to create value objects, falling back to legacy format', {
          recipient: dto.recipient,
          channel: dto.channel,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Continue with legacy fields only
      }

      // Create notification entity within transaction
      const notificationRepo = manager.getRepository(Notification);
      const notification = await notificationRepo.save({
        channel: dto.channel,
        
        // Legacy fields (backward compatibility)
        recipient: dto.recipient,
        subject: dto.subject,
        content: dto.content,
        
        // New value object fields (preferred)
        recipientVO,
        contentVO,
        
        metadata: dto.metadata || {},
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
        status: NotificationStatus.CREATED,
      });

      // Queue for processing with normal priority by default
      await this.notificationProducer.addNotificationJob(
        notification.id,
        NotificationPriority.NORMAL,
        notification.scheduledFor || undefined,
        notification.metadata,
      );

      // Update status to queued
      await this.notificationRepository.updateStatus(
        notification.id,
        NotificationStatus.QUEUED,
      );

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
    if (dto.content !== undefined) {
      updateData.content = dto.content;
      
      // Update content value object if content is being updated
      try {
        updateData.contentVO = NotificationContent.create(dto.content, notification.channel);
      } catch (error) {
        this.logger.warn('Failed to create content value object during update', {
          notificationId: id,
          channel: notification.channel,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Keep legacy content field, set contentVO to null
        updateData.contentVO = null;
      }
    }
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
        const removed =
          await this.notificationProducer.removeNotificationJob(id);
        if (removed) {
          this.logger.debug(`Removed job for notification ${id}`);
        } else {
          this.logger.debug(`No job found to remove for notification ${id}`);
        }
      } catch (error) {
        // Job might not exist or already processed, which is fine
        this.logger.debug(
          `Could not remove job for notification ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
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

    if (!notification.canRetry(this.config.maxRetries)) {
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

    // Queue with high priority for retries
    await this.notificationProducer.addNotificationJob(
      id,
      NotificationPriority.HIGH,
      undefined, // No delay for retries
      { retryAttempt: true },
    );

    // Update status to queued
    await this.notificationRepository.updateStatus(
      id,
      NotificationStatus.QUEUED,
    );

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
  private async requeueNotification(
    notificationId: string,
    scheduledFor: Date | null,
  ): Promise<void> {
    // Remove existing job
    try {
      await this.notificationProducer.removeNotificationJob(notificationId);
      this.logger.debug(
        `Removed existing job for notification ${notificationId}`,
      );
    } catch (error) {
      // Job might not exist, which is fine
      this.logger.debug(
        `No existing job found for notification ${notificationId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    // Add new job with updated schedule
    await this.notificationProducer.addNotificationJob(
      notificationId,
      NotificationPriority.NORMAL,
      scheduledFor || undefined,
      { rescheduled: true },
    );

    // Update status to queued
    await this.notificationRepository.updateStatus(
      notificationId,
      NotificationStatus.QUEUED,
    );
  }
}
