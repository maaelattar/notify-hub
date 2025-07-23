import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { CreateNotificationDto } from '../dto/create-notification.dto';
import { UpdateNotificationDto } from '../dto/update-notification.dto';
import { Notification } from '../entities/notification.entity';
import { NotificationRepository } from '../repositories/notification.repository';
import { NotificationProducer } from './notification.producer';
import { NotificationValidatorService } from './notification-validator.service';
import { NotificationQueryService } from './notification-query.service';
import { Recipient } from '../value-objects/recipient.value-object';
import { NotificationContent } from '../value-objects/notification-content.value-object';
import { NotificationStatus } from '../enums/notification-status.enum';
import { NotificationPriority } from '../enums/notification-priority.enum';
import { NotificationConfiguration } from '../../../common/types/notification.types';
import { EventBusService } from '../../events/event-bus.service';
import {
  NotificationCreatedEvent,
  NotificationQueuedEvent,
  NotificationUpdatedEvent,
  NotificationCancelledEvent,
  NotificationRetriedEvent,
} from '../../../common/events/domain-events';
import { NotificationOperationFailedException } from '../exceptions/notification.exceptions';

@Injectable()
export class NotificationCommandService {
  private readonly logger = new Logger(NotificationCommandService.name);
  private readonly config: NotificationConfiguration;

  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationRepository: NotificationRepository,
    private readonly notificationProducer: NotificationProducer,
    private readonly validatorService: NotificationValidatorService,
    private readonly queryService: NotificationQueryService,
    private readonly configService: ConfigService,
  ) {
    this.config =
      this.configService.get<NotificationConfiguration>('notification')!;
  }

  async create(dto: CreateNotificationDto): Promise<Notification> {
    this.logger.log(
      `Creating notification for ${dto.recipient} via ${dto.channel}`,
    );

    await this.validateNotificationData(dto);
    const notificationData = this.prepareNotificationData(dto);

    return this.dataSource.transaction(async (manager) => {
      const notificationRepo = manager.getRepository(Notification);
      const createdNotification = await notificationRepo.save({
        ...notificationData,
        status: NotificationStatus.CREATED,
      });

      await this.notificationProducer.addNotificationJob(
        createdNotification.id,
        NotificationPriority.NORMAL,
        createdNotification.scheduledFor || undefined,
        createdNotification.metadata,
      );

      await manager.update(Notification, createdNotification.id, {
        status: NotificationStatus.QUEUED,
      });

      this.logger.log(
        `Notification ${createdNotification.id} created and queued`,
      );
      createdNotification.status = NotificationStatus.QUEUED;
      return createdNotification;
    });
  }

  async update(id: string, dto: UpdateNotificationDto): Promise<Notification> {
    this.logger.log(`Updating notification ${id}`);

    const notification = await this.queryService.findById(id);
    this.validateUpdateAllowed(notification);

    const updateData = this.prepareUpdateData(dto, notification);
    const shouldRequeue = this.shouldRequeue(
      notification.scheduledFor,
      updateData.scheduledFor || null,
    );

    return this.dataSource.transaction(async (manager) => {
      await manager.update(Notification, id, updateData);
      const updated = await manager.findOneBy(Notification, { id });

      if (!updated) {
        throw new Error('Failed to retrieve updated notification');
      }

      if (shouldRequeue) {
        await this.requeueNotification(updated.id, updated.scheduledFor);
      }

      this.logger.log(`Notification ${id} updated`);
      return updated;
    });
  }

  async cancel(id: string): Promise<Notification> {
    this.logger.log(`Cancelling notification ${id}`);

    const notification = await this.queryService.findById(id);
    this.validateCancellationAllowed(notification);

    return this.dataSource.transaction(async (manager) => {
      await manager.update(Notification, id, {
        status: NotificationStatus.CANCELLED,
      });
      const cancelled = await manager.findOneBy(Notification, { id });

      if (!cancelled) {
        throw new Error('Failed to retrieve cancelled notification');
      }

      try {
        const removed =
          await this.notificationProducer.removeNotificationJob(id);
        if (removed) {
          this.logger.debug(`Removed job for notification ${id}`);
        }
      } catch (error) {
        this.logger.debug(
          `Could not remove job for notification ${id}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }

      this.logger.log(`Notification ${id} cancelled`);
      return cancelled;
    });
  }

  async retry(id: string): Promise<Notification> {
    this.logger.log(`Retrying notification ${id}`);

    const notification = await this.queryService.findById(id);
    this.validateRetryAllowed(notification);

    await this.notificationRepository.update(id, {
      status: NotificationStatus.CREATED,
      retryCount: notification.retryCount + 1,
    });

    await this.notificationProducer.addNotificationJob(
      id,
      NotificationPriority.HIGH,
      undefined,
      { retryAttempt: true },
    );

    await this.notificationRepository.updateStatus(
      id,
      NotificationStatus.QUEUED,
    );

    await this.eventBus.publish(
      this.eventBus.createEvent<NotificationRetriedEvent>(
        'NotificationRetried',
        id,
        'Notification',
        {
          notificationId: id,
          channel: notification.channel,
          retriedAt: new Date(),
          retryCount: notification.retryCount + 1,
          previousError: notification.lastError || undefined,
          triggeredBy: undefined, // TODO: Get user ID from context
        },
      ),
    );

    await this.eventBus.publish(
      this.eventBus.createEvent<NotificationQueuedEvent>(
        'NotificationQueued',
        id,
        'Notification',
        {
          notificationId: id,
          channel: notification.channel,
          priority: NotificationPriority.HIGH,
          queuedAt: new Date(),
          estimatedDeliveryTime: undefined,
        },
      ),
    );

    this.logger.log(`Notification ${id} queued for retry`);
    return this.queryService.findById(id);
  }

  private async validateNotificationData(
    dto: CreateNotificationDto,
  ): Promise<void> {
    const validationResult =
      await this.validatorService.validateWithCategories(dto);

    if (!validationResult.isValid) {
      throw new BadRequestException({
        message: 'Notification validation failed',
        errors: validationResult.allErrors,
      });
    }
  }

  private prepareNotificationData(
    dto: CreateNotificationDto,
  ): Partial<Notification> {
    const recipientVO = Recipient.create(dto.recipient, dto.channel);
    const contentVO = NotificationContent.create(dto.content, dto.channel);

    return {
      channel: dto.channel,
      recipient: dto.recipient,
      subject: dto.subject,
      content: dto.content,
      recipientVO,
      contentVO,
      metadata: dto.metadata || {},
      scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
    };
  }

  private validateUpdateAllowed(notification: Notification): void {
    if (
      notification.status === NotificationStatus.SENT ||
      notification.status === NotificationStatus.DELIVERED
    ) {
      throw new BadRequestException(
        'Cannot update notifications that have been sent or delivered',
      );
    }
  }

  private prepareUpdateData(
    dto: UpdateNotificationDto,
    notification: Notification,
  ): Partial<Notification> {
    const updateData: Partial<Notification> = {};

    if (dto.subject !== undefined) {
      updateData.subject = dto.subject;
    }
    if (dto.content !== undefined) {
      updateData.content = dto.content;
      updateData.contentVO = NotificationContent.create(
        dto.content,
        notification.channel,
      );
    }
    if (dto.metadata !== undefined) {
      updateData.metadata = dto.metadata;
    }
    if (dto.scheduledFor !== undefined) {
      updateData.scheduledFor = dto.scheduledFor
        ? ScheduledFor.create(dto.scheduledFor).getValue()
        : null;
    }
    if (dto.status !== undefined) {
      updateData.status = dto.status;
    }

    return updateData;
  }

  private validateCancellationAllowed(notification: Notification): void {
    try {
      notification.markAsCancelled();
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  private validateRetryAllowed(notification: Notification): void {
    if (!notification.canRetry(this.config.maxRetries)) {
      throw new BadRequestException('Notification cannot be retried');
    }
  }

  private shouldRequeue(
    oldSchedule: Date | null,
    newSchedule: Date | null,
  ): boolean {
    if (oldSchedule === null && newSchedule === null) return false;
    if (oldSchedule === null || newSchedule === null) return true;
    return oldSchedule.getTime() !== newSchedule.getTime();
  }

  private async requeueNotification(
    notificationId: string,
    scheduledFor: Date | null,
  ): Promise<void> {
    await this.notificationProducer.removeNotificationJob(notificationId);
    await this.notificationProducer.addNotificationJob(
      notificationId,
      NotificationPriority.NORMAL,
      scheduledFor || undefined,
      { rescheduled: true },
    );
    await this.notificationRepository.updateStatus(
      notificationId,
      NotificationStatus.QUEUED,
    );
  }
}
