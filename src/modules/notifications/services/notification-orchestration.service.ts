import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NotificationRepository } from '../repositories/notification.repository';
import { NotificationProducer } from './notification.producer';
import { Notification } from '../entities/notification.entity';
import { NotificationStatus } from '../enums/notification-status.enum';
import { NotificationPriority } from '../enums/notification-priority.enum';

/**
 * Orchestration service that handles cross-cutting concerns for notifications
 * Separates transaction management and queue operations from business logic
 */
@Injectable()
export class NotificationOrchestrationService {
  private readonly logger = new Logger(NotificationOrchestrationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationRepository: NotificationRepository,
    private readonly notificationProducer: NotificationProducer,
  ) {}

  /**
   * Orchestrates notification creation with transaction and queue management
   */
  async createNotification(
    notificationData: Partial<Notification>,
    priority: NotificationPriority = NotificationPriority.NORMAL,
  ): Promise<Notification> {
    return await this.dataSource.transaction(async (manager) => {
      // Create notification entity within transaction
      const notificationRepo = manager.getRepository(Notification);
      const notification = await notificationRepo.save({
        ...notificationData,
        status: NotificationStatus.CREATED,
      });

      // Queue for processing
      await this.notificationProducer.addNotificationJob(
        notification.id,
        priority,
        notification.scheduledFor || undefined,
        notification.metadata,
      );

      // Update status to queued
      await this.notificationRepository.updateStatus(
        notification.id,
        NotificationStatus.QUEUED,
      );

      this.logger.log(`Notification ${notification.id} created and queued`);
      return notification;
    });
  }

  /**
   * Orchestrates notification updates with transaction management
   */
  async updateNotification(
    id: string,
    updateData: Partial<Notification>,
    shouldRequeue: boolean = false,
  ): Promise<Notification> {
    return await this.dataSource.transaction(async (manager) => {
      // Apply updates within transaction
      const notificationRepo = manager.getRepository(Notification);
      await notificationRepo.update(id, updateData);
      const updated = await notificationRepo.findOne({ where: { id } });

      if (!updated) {
        throw new Error('Failed to retrieve updated notification');
      }

      // Re-queue if requested (outside transaction scope)
      if (shouldRequeue) {
        await this.requeueNotification(updated.id, updated.scheduledFor);
      }

      this.logger.log(`Notification ${id} updated`);
      return updated;
    });
  }

  /**
   * Orchestrates notification cancellation with queue cleanup
   */
  async cancelNotification(
    id: string,
    newStatus: NotificationStatus,
  ): Promise<Notification> {
    return await this.dataSource.transaction(async (manager) => {
      // Update notification status within transaction
      const notificationRepo = manager.getRepository(Notification);
      await notificationRepo.update(id, { status: newStatus });

      const notification = await notificationRepo.findOne({ where: { id } });
      if (!notification) {
        throw new Error('Failed to retrieve cancelled notification');
      }

      // Remove from queue (after transaction)
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
          `Could not remove job for notification ${id}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }

      this.logger.log(`Notification ${id} cancelled`);
      return notification;
    });
  }

  /**
   * Orchestrates notification retry with queue management
   */
  async retryNotification(
    id: string,
    resetStatus: NotificationStatus = NotificationStatus.CREATED,
  ): Promise<void> {
    // Reset status
    await this.notificationRepository.update(id, { status: resetStatus });

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
  }

  /**
   * Private helper for requeuing notifications with schedule changes
   */
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
        `No existing job found for notification ${notificationId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
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
