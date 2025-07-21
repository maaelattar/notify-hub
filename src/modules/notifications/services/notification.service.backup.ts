import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { NotificationValidatorService } from './notification-validator.service';
import { NotificationOrchestrationService } from './notification-orchestration.service';
import { Recipient } from '../value-objects/recipient.value-object';
import { NotificationContent } from '../value-objects/notification-content.value-object';
import { Pagination } from '../../../common/value-objects/pagination.vo';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly config: NotificationConfig;

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly configService: ConfigService,
    private readonly validatorService: NotificationValidatorService,
    private readonly orchestrationService: NotificationOrchestrationService,
  ) {
    this.config = this.configService.get<NotificationConfig>('notification')!;
  }

  async create(dto: CreateNotificationDto): Promise<NotificationResponseDto> {
    this.logger.log(
      `Creating notification for ${dto.recipient} via ${dto.channel}`,
    );

    // Business Logic: Comprehensive validation
    const validationResult =
      await this.validatorService.validateWithCategories(dto);
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
        errors: validationResult.allErrors.map((error) => ({
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

    // Business Logic: Prepare notification data with value objects
    const notificationData = this.prepareNotificationData(dto);

    // Orchestration: Handle transaction and queue management
    const notification = await this.orchestrationService.createNotification(
      notificationData,
      NotificationPriority.NORMAL,
    );

    return NotificationResponseDto.fromEntity(notification);
  }

  /**
   * Pure business logic: Prepare notification data with value objects
   */
  private prepareNotificationData(
    dto: CreateNotificationDto,
  ): Partial<Notification> {
    // Create value objects with enhanced validation and business logic
    let recipientVO: Recipient | null = null;
    let contentVO: NotificationContent | null = null;

    try {
      // Create recipient value object with channel context
      recipientVO = Recipient.create(dto.recipient, dto.channel);

      // Create content value object with channel-specific format detection
      contentVO = NotificationContent.create(dto.content, dto.channel);
    } catch (error) {
      this.logger.warn(
        'Failed to create value objects, falling back to legacy format',
        {
          recipient: dto.recipient,
          channel: dto.channel,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );
      // Continue with legacy fields only
    }

    return {
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
    };
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
    const pagination = filters.pagination || new Pagination();
    const limit = Math.min(pagination.limit, this.config.maxPageSize);
    const adjustedPagination =
      pagination.limit > this.config.maxPageSize
        ? pagination.withLimit(this.config.maxPageSize)
        : pagination;

    const result = await this.notificationRepository.findAll(
      {
        status: filters.status,
        channel: filters.channel,
        recipient: filters.recipient,
      },
      { page: adjustedPagination.page, limit: adjustedPagination.limit },
    );

    const notificationDtos = result.data.map((n) =>
      NotificationResponseDto.fromEntity(n),
    );

    return PaginatedResponseDto.create(
      notificationDtos,
      result.total,
      adjustedPagination,
    );
  }

  async update(
    id: string,
    dto: UpdateNotificationDto,
  ): Promise<NotificationResponseDto> {
    // Business Logic: Validate existence and business rules
    const notification = await this.notificationRepository.findById(id);

    if (!notification) {
      this.logger.warn(`Attempted to update non-existent notification`, { id });
      throw new NotFoundException({
        message: `Notification not found`,
        context: { notificationId: id },
      });
    }

    // Business rule: Can't update sent notifications
    this.validateUpdateAllowed(notification, id);

    // Business Logic: Prepare update data
    const updateData = this.prepareUpdateData(dto, notification, id);

    // Check if requeue is needed
    const shouldRequeue =
      dto.scheduledFor !== undefined &&
      notification.scheduledFor?.getTime() !==
        updateData.scheduledFor?.getTime();

    // Orchestration: Handle transaction and queue management
    const updated = await this.orchestrationService.updateNotification(
      id,
      updateData,
      shouldRequeue,
    );

    return NotificationResponseDto.fromEntity(updated);
  }

  /**
   * Pure business logic: Validate that notification can be updated
   */
  private validateUpdateAllowed(notification: Notification, id: string): void {
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
  }

  /**
   * Pure business logic: Prepare update data with value objects
   */
  private prepareUpdateData(
    dto: UpdateNotificationDto,
    notification: Notification,
    id: string,
  ): Partial<Notification> {
    const updateData: Partial<Notification> = {};

    if (dto.subject !== undefined) updateData.subject = dto.subject;
    if (dto.content !== undefined) {
      updateData.content = dto.content;

      // Update content value object if content is being updated
      try {
        updateData.contentVO = NotificationContent.create(
          dto.content,
          notification.channel,
        );
      } catch (error) {
        this.logger.warn(
          'Failed to create content value object during update',
          {
            notificationId: id,
            channel: notification.channel,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        );
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

    return updateData;
  }

  async cancel(id: string): Promise<NotificationResponseDto> {
    // Business Logic: Validate existence
    const notification = await this.notificationRepository.findById(id);

    if (!notification) {
      this.logger.warn(`Attempted to cancel non-existent notification`, { id });
      throw new NotFoundException({
        message: `Notification not found`,
        context: { notificationId: id },
      });
    }

    // Business Logic: Use entity method for business rules
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

    // Orchestration: Handle transaction and queue cleanup
    const cancelledNotification =
      await this.orchestrationService.cancelNotification(
        id,
        notification.status,
      );

    return NotificationResponseDto.fromEntity(cancelledNotification);
  }

  async retry(id: string): Promise<NotificationResponseDto> {
    // Business Logic: Validate existence
    const notification = await this.notificationRepository.findById(id);

    if (!notification) {
      this.logger.warn(`Attempted to retry non-existent notification`, { id });
      throw new NotFoundException({
        message: `Notification not found`,
        context: { notificationId: id },
      });
    }

    // Business Logic: Validate retry eligibility using business rules
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

    // Orchestration: Handle retry queue management
    await this.orchestrationService.retryNotification(
      id,
      NotificationStatus.CREATED,
    );

    // Return updated notification for response
    notification.status = NotificationStatus.QUEUED;
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
}
