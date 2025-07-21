import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreateNotificationDto } from '../dto/create-notification.dto';
import { UpdateNotificationDto } from '../dto/update-notification.dto';
import { Notification } from '../entities/notification.entity';
import { NotificationStatus } from '../enums/notification-status.enum';
import { NotificationValidatorService } from './notification-validator.service';
import { Recipient } from '../value-objects/recipient.value-object';
import { NotificationContent } from '../value-objects/notification-content.value-object';
import { NotificationConfiguration } from '../../../common/types/notification.types';

/**
 * Service responsible for pure business logic operations
 * Handles data preparation, validation coordination, and business rules
 * Separated from orchestration and data access concerns
 */
@Injectable()
export class NotificationBusinessLogicService {
  private readonly logger = new Logger(NotificationBusinessLogicService.name);
  private readonly config: NotificationConfiguration;

  constructor(
    private readonly configService: ConfigService,
    private readonly validatorService: NotificationValidatorService,
  ) {
    this.config =
      this.configService.get<NotificationConfiguration>('notification')!;
  }

  /**
   * Validates notification data with comprehensive business rules
   */
  async validateNotificationData(dto: CreateNotificationDto): Promise<void> {
    this.logger.debug(
      `Validating notification for ${dto.recipient} via ${dto.channel}`,
    );

    const validationResult =
      await this.validatorService.validateWithCategories(dto);

    if (!validationResult.isValid) {
      this.logger.warn(`Validation failed for notification creation`, {
        recipient: this.maskSensitiveData(dto.recipient),
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
          recipient: this.maskSensitiveData(dto.recipient),
        },
      });
    }
  }

  /**
   * Prepares notification data with value objects and business logic
   */
  prepareNotificationData(dto: CreateNotificationDto): Partial<Notification> {
    this.logger.debug(`Preparing notification data for ${dto.channel} channel`);

    // Create value objects with enhanced validation and business logic
    let recipientVO: Recipient | null = null;
    let contentVO: NotificationContent | null = null;

    try {
      // Create recipient value object with channel context
      recipientVO = Recipient.create(dto.recipient, dto.channel);
      this.logger.debug(
        `Created recipient value object for ${recipientVO.getType()}`,
      );
    } catch (error) {
      this.logger.warn(
        'Failed to create recipient value object, using legacy format',
        {
          recipient: this.maskSensitiveData(dto.recipient),
          channel: dto.channel,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );
      // Continue with legacy fields only
    }

    try {
      // Create content value object with channel-specific format detection
      contentVO = NotificationContent.create(dto.content, dto.channel);
      this.logger.debug(
        `Created content value object with format: ${contentVO.getFormat()}`,
      );

      // Validate content compatibility with channel
      if (!contentVO.isCompatibleWith(dto.channel)) {
        this.logger.warn(
          `Content may not be compatible with ${dto.channel} channel`,
          {
            contentFormat: contentVO.getFormat(),
            contentLength: contentVO.getCharacterCount(),
            channel: dto.channel,
          },
        );
      }
    } catch (error) {
      this.logger.warn(
        'Failed to create content value object, using legacy format',
        {
          channel: dto.channel,
          contentLength: dto.content.length,
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

  /**
   * Validates that a notification can be updated based on business rules
   */
  validateUpdateAllowed(notification: Notification): void {
    if (
      notification.status === NotificationStatus.SENT ||
      notification.status === NotificationStatus.DELIVERED
    ) {
      this.logger.warn(`Attempted to update notification in final state`, {
        notificationId: notification.id,
        currentStatus: notification.status,
        channel: notification.channel,
      });

      throw new BadRequestException({
        message: 'Cannot update notifications that have been sent or delivered',
        context: {
          notificationId: notification.id,
          currentStatus: notification.status,
          channel: notification.channel,
        },
      });
    }
  }

  /**
   * Prepares update data with business logic and value object handling
   */
  prepareUpdateData(
    dto: UpdateNotificationDto,
    notification: Notification,
  ): Partial<Notification> {
    this.logger.debug(
      `Preparing update data for notification ${notification.id}`,
    );

    const updateData: Partial<Notification> = {};

    // Handle subject updates
    if (dto.subject !== undefined) {
      updateData.subject = dto.subject;
    }

    // Handle content updates with value object recreation
    if (dto.content !== undefined) {
      updateData.content = dto.content;

      try {
        updateData.contentVO = NotificationContent.create(
          dto.content,
          notification.channel,
        );
        this.logger.debug(
          `Updated content value object for notification ${notification.id}`,
        );
      } catch (error) {
        this.logger.warn(
          'Failed to create content value object during update',
          {
            notificationId: notification.id,
            channel: notification.channel,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        );
        // Keep legacy content field, set contentVO to null
        updateData.contentVO = null;
      }
    }

    // Handle metadata updates
    if (dto.metadata !== undefined) {
      updateData.metadata = dto.metadata;
    }

    // Handle schedule updates
    if (dto.scheduledFor !== undefined) {
      updateData.scheduledFor = dto.scheduledFor
        ? new Date(dto.scheduledFor)
        : null;
    }

    // Handle status updates (if provided)
    if (dto.status !== undefined) {
      updateData.status = dto.status;
    }

    return updateData;
  }

  /**
   * Validates that a notification can be cancelled based on business rules
   */
  validateCancellationAllowed(notification: Notification): void {
    try {
      notification.markAsCancelled();
    } catch (error) {
      this.logger.warn(`Failed to cancel notification due to business rule`, {
        notificationId: notification.id,
        currentStatus: notification.status,
        channel: notification.channel,
        error: (error as Error).message,
      });

      throw new BadRequestException({
        message: 'Cannot cancel notification in current state',
        context: {
          notificationId: notification.id,
          currentStatus: notification.status,
          channel: notification.channel,
          reason: (error as Error).message,
        },
      });
    }
  }

  /**
   * Validates that a notification can be retried based on business rules
   */
  validateRetryAllowed(notification: Notification): void {
    if (!notification.canRetry(this.config.maxRetries)) {
      this.logger.warn(
        'Attempted to retry notification that cannot be retried',
        {
          notificationId: notification.id,
          currentStatus: notification.status,
          retryCount: notification.retryCount,
          maxRetries: this.config.maxRetries,
        },
      );

      throw new BadRequestException({
        message: 'Notification cannot be retried',
        context: {
          notificationId: notification.id,
          currentStatus: notification.status,
          retryCount: notification.retryCount,
          maxRetries: this.config.maxRetries,
        },
      });
    }
  }

  /**
   * Determines if schedule change requires requeuing
   */
  shouldRequeue(oldSchedule: Date | null, newSchedule: Date | null): boolean {
    if (oldSchedule === null && newSchedule === null) return false;
    if (oldSchedule === null || newSchedule === null) return true;

    return oldSchedule.getTime() !== newSchedule.getTime();
  }

  /**
   * Masks sensitive data for logging
   */
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

    if (data.startsWith('http')) {
      // URL masking
      try {
        const url = new URL(data);
        return `${url.protocol}//${url.hostname}/***`;
      } catch {
        return '***';
      }
    }

    // Generic masking
    return data.length > 6 ? `${data.substring(0, 3)}***` : '***';
  }
}
