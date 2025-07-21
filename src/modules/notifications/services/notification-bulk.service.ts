import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { CreateNotificationDto } from '../dto/create-notification.dto';
import { UpdateNotificationDto } from '../dto/update-notification.dto';
import { NotificationResponseDto } from '../dto/notification-response.dto';
import { Notification } from '../entities/notification.entity';
import { NotificationStatus } from '../enums/notification-status.enum';
import { NotificationPriority } from '../enums/notification-priority.enum';
import { NotificationBusinessLogicService } from './notification-business-logic.service';
import { NotificationDataAccessService } from './notification-data-access.service';
import { NotificationOrchestrationService } from './notification-orchestration.service';
import { EventBusService } from '../../../common/events/event-bus.service';
import { BulkOperationCompletedEvent } from '../../../common/events/domain-events';
import { CacheService } from '../../../common/services/cache.service';
import { NotificationConfiguration } from '../../../common/types/notification.types';

export interface BulkCreateRequest {
  notifications: CreateNotificationDto[];
  priority?: NotificationPriority;
  batchSize?: number;
  continueOnError?: boolean;
}

export interface BulkUpdateRequest {
  updates: Array<{
    id: string;
    data: UpdateNotificationDto;
  }>;
  batchSize?: number;
  continueOnError?: boolean;
}

export interface BulkOperationResult<T = any> {
  totalCount: number;
  successCount: number;
  failureCount: number;
  duration: number; // milliseconds
  results: Array<{
    id?: string;
    success: boolean;
    data?: T;
    error?: string;
  }>;
  errors: Array<{
    entityId?: string;
    error: string;
    index: number;
  }>;
}

/**
 * High-performance bulk operations service for notifications
 * Implements batch processing with configurable parallelism and error handling
 * Provides transactional guarantees and comprehensive error reporting
 */
@Injectable()
export class NotificationBulkService {
  private readonly logger = new Logger(NotificationBulkService.name);
  private readonly config: NotificationConfiguration;
  private readonly defaultBatchSize: number;
  private readonly maxParallelism: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly businessLogic: NotificationBusinessLogicService,
    private readonly dataAccess: NotificationDataAccessService,
    private readonly orchestration: NotificationOrchestrationService,
    private readonly eventBus: EventBusService,
    private readonly cacheService: CacheService,
  ) {
    this.config =
      this.configService.get<NotificationConfiguration>('notification')!;
    this.defaultBatchSize = this.configService.get<number>(
      'BULK_DEFAULT_BATCH_SIZE',
      100,
    );
    this.maxParallelism = this.configService.get<number>(
      'BULK_MAX_PARALLELISM',
      5,
    );
  }

  /**
   * Bulk create notifications with high-performance batch processing
   */
  async bulkCreate(
    request: BulkCreateRequest,
  ): Promise<BulkOperationResult<NotificationResponseDto>> {
    const startTime = Date.now();
    const batchSize = Math.min(request.batchSize || this.defaultBatchSize, 500);
    const notifications = request.notifications;

    this.logger.log(`Starting bulk create operation`, {
      totalCount: notifications.length,
      batchSize,
      continueOnError: request.continueOnError,
    });

    const result: BulkOperationResult<NotificationResponseDto> = {
      totalCount: notifications.length,
      successCount: 0,
      failureCount: 0,
      duration: 0,
      results: [],
      errors: [],
    };

    try {
      // Process in batches with controlled parallelism
      const batches = this.createBatches(notifications, batchSize);
      const semaphore = new Semaphore(this.maxParallelism);

      const batchPromises = batches.map(async (batch, batchIndex) => {
        return semaphore.acquire(async () => {
          try {
            const batchResult = await this.processBulkCreateBatch(
              batch,
              batchIndex,
              request.priority || NotificationPriority.NORMAL,
              request.continueOnError || false,
            );

            // Merge batch results
            result.successCount += batchResult.successCount;
            result.failureCount += batchResult.failureCount;
            result.results.push(...batchResult.results);
            result.errors.push(...batchResult.errors);
          } catch (error) {
            this.logger.error(`Batch ${batchIndex} failed completely`, {
              batchSize: batch.length,
              error: error instanceof Error ? error.message : 'Unknown error',
            });

            // Mark all items in batch as failed
            batch.forEach((_, itemIndex) => {
              const globalIndex = batchIndex * batchSize + itemIndex;
              result.failureCount++;
              result.results.push({
                success: false,
                error:
                  error instanceof Error
                    ? error.message
                    : 'Batch processing failed',
              });
              result.errors.push({
                error:
                  error instanceof Error
                    ? error.message
                    : 'Batch processing failed',
                index: globalIndex,
              });
            });
          }
        });
      });

      await Promise.all(batchPromises);

      result.duration = Date.now() - startTime;

      // Publish bulk operation completed event
      await this.publishBulkOperationEvent('create', result);

      // Invalidate relevant caches
      await this.invalidateStatsCache();

      this.logger.log(`Bulk create operation completed`, {
        totalCount: result.totalCount,
        successCount: result.successCount,
        failureCount: result.failureCount,
        duration: result.duration,
        successRate: (result.successCount / result.totalCount) * 100,
      });

      return result;
    } catch (error) {
      result.duration = Date.now() - startTime;

      this.logger.error(`Bulk create operation failed`, {
        totalCount: notifications.length,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: result.duration,
      });

      throw error;
    }
  }

  /**
   * Bulk update notifications
   */
  async bulkUpdate(
    request: BulkUpdateRequest,
  ): Promise<BulkOperationResult<NotificationResponseDto>> {
    const startTime = Date.now();
    const batchSize = Math.min(request.batchSize || this.defaultBatchSize, 200);
    const updates = request.updates;

    this.logger.log(`Starting bulk update operation`, {
      totalCount: updates.length,
      batchSize,
      continueOnError: request.continueOnError,
    });

    const result: BulkOperationResult<NotificationResponseDto> = {
      totalCount: updates.length,
      successCount: 0,
      failureCount: 0,
      duration: 0,
      results: [],
      errors: [],
    };

    try {
      // Process in batches
      const batches = this.createBatches(updates, batchSize);

      for (const [batchIndex, batch] of batches.entries()) {
        try {
          const batchResult = await this.processBulkUpdateBatch(
            batch,
            batchIndex,
            request.continueOnError || false,
          );

          // Merge batch results
          result.successCount += batchResult.successCount;
          result.failureCount += batchResult.failureCount;
          result.results.push(...batchResult.results);
          result.errors.push(...batchResult.errors);
        } catch (error) {
          if (!request.continueOnError) {
            throw error;
          }

          this.logger.error(
            `Batch ${batchIndex} failed, continuing with next batch`,
            {
              batchSize: batch.length,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          );
        }
      }

      result.duration = Date.now() - startTime;

      // Publish bulk operation completed event
      await this.publishBulkOperationEvent('update', result);

      // Invalidate relevant caches
      await this.invalidateNotificationCaches(updates.map((u) => u.id));

      this.logger.log(`Bulk update operation completed`, {
        totalCount: result.totalCount,
        successCount: result.successCount,
        failureCount: result.failureCount,
        duration: result.duration,
      });

      return result;
    } catch (error) {
      result.duration = Date.now() - startTime;

      this.logger.error(`Bulk update operation failed`, {
        totalCount: updates.length,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: result.duration,
      });

      throw error;
    }
  }

  /**
   * Bulk cancel notifications
   */
  async bulkCancel(
    notificationIds: string[],
    reason: string = 'Bulk cancellation',
    batchSize: number = this.defaultBatchSize,
  ): Promise<BulkOperationResult<{ id: string; cancelled: boolean }>> {
    const startTime = Date.now();

    this.logger.log(`Starting bulk cancel operation`, {
      totalCount: notificationIds.length,
      batchSize,
      reason,
    });

    const result: BulkOperationResult<{ id: string; cancelled: boolean }> = {
      totalCount: notificationIds.length,
      successCount: 0,
      failureCount: 0,
      duration: 0,
      results: [],
      errors: [],
    };

    try {
      // Process in batches using the data access service bulk update
      const cancelledCount = await this.dataAccess.bulkUpdateStatus(
        notificationIds,
        NotificationStatus.CANCELLED,
      );

      result.successCount = cancelledCount;
      result.failureCount = notificationIds.length - cancelledCount;
      result.duration = Date.now() - startTime;

      // Create results array
      notificationIds.forEach((id, index) => {
        const success = index < cancelledCount;
        result.results.push({
          id,
          success,
          data: { id, cancelled: success },
          error: success ? undefined : 'Failed to cancel notification',
        });

        if (!success) {
          result.errors.push({
            entityId: id,
            error: 'Failed to cancel notification',
            index,
          });
        }
      });

      // Publish bulk operation completed event
      await this.publishBulkOperationEvent('cancel', result);

      // Invalidate caches
      await this.invalidateNotificationCaches(notificationIds);

      this.logger.log(`Bulk cancel operation completed`, {
        totalCount: result.totalCount,
        successCount: result.successCount,
        failureCount: result.failureCount,
        duration: result.duration,
      });

      return result;
    } catch (error) {
      result.duration = Date.now() - startTime;

      this.logger.error(`Bulk cancel operation failed`, {
        totalCount: notificationIds.length,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: result.duration,
      });

      throw error;
    }
  }

  /**
   * Bulk retry failed notifications
   */
  async bulkRetry(
    notificationIds: string[],
    batchSize: number = this.defaultBatchSize,
  ): Promise<BulkOperationResult<{ id: string; retried: boolean }>> {
    const startTime = Date.now();

    this.logger.log(`Starting bulk retry operation`, {
      totalCount: notificationIds.length,
      batchSize,
    });

    const result: BulkOperationResult<{ id: string; retried: boolean }> = {
      totalCount: notificationIds.length,
      successCount: 0,
      failureCount: 0,
      duration: 0,
      results: [],
      errors: [],
    };

    try {
      // Process notifications individually for retry validation
      const batches = this.createBatches(notificationIds, batchSize);

      for (const batch of batches) {
        await Promise.all(
          batch.map(async (id, index) => {
            try {
              // Get notification and validate retry is allowed
              const notification = await this.dataAccess.findByIdOrNull(id);

              if (!notification) {
                throw new Error('Notification not found');
              }

              this.businessLogic.validateRetryAllowed(notification);

              // Retry using orchestration service
              await this.orchestration.retryNotification(
                id,
                NotificationStatus.CREATED,
              );

              result.successCount++;
              result.results.push({
                id,
                success: true,
                data: { id, retried: true },
              });
            } catch (error) {
              result.failureCount++;
              const errorMessage =
                error instanceof Error ? error.message : 'Unknown error';

              result.results.push({
                id,
                success: false,
                error: errorMessage,
              });

              result.errors.push({
                entityId: id,
                error: errorMessage,
                index,
              });
            }
          }),
        );
      }

      result.duration = Date.now() - startTime;

      // Publish bulk operation completed event
      await this.publishBulkOperationEvent('retry', result);

      // Invalidate caches
      await this.invalidateNotificationCaches(notificationIds);

      this.logger.log(`Bulk retry operation completed`, {
        totalCount: result.totalCount,
        successCount: result.successCount,
        failureCount: result.failureCount,
        duration: result.duration,
      });

      return result;
    } catch (error) {
      result.duration = Date.now() - startTime;

      this.logger.error(`Bulk retry operation failed`, {
        totalCount: notificationIds.length,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: result.duration,
      });

      throw error;
    }
  }

  /**
   * Process a batch of create operations
   */
  private async processBulkCreateBatch(
    notifications: CreateNotificationDto[],
    batchIndex: number,
    priority: NotificationPriority,
    continueOnError: boolean,
  ): Promise<BulkOperationResult<NotificationResponseDto>> {
    const batchResult: BulkOperationResult<NotificationResponseDto> = {
      totalCount: notifications.length,
      successCount: 0,
      failureCount: 0,
      duration: 0,
      results: [],
      errors: [],
    };

    this.logger.debug(`Processing create batch ${batchIndex}`, {
      batchSize: notifications.length,
    });

    // Use transaction for batch consistency
    await this.dataSource.transaction(async (manager) => {
      for (const [itemIndex, dto] of notifications.entries()) {
        try {
          // Validate and prepare data
          await this.businessLogic.validateNotificationData(dto);
          const notificationData =
            this.businessLogic.prepareNotificationData(dto);

          // Create notification within transaction
          const notification = await this.orchestration.createNotification(
            notificationData,
            priority,
          );

          batchResult.successCount++;
          batchResult.results.push({
            id: notification.id,
            success: true,
            data: NotificationResponseDto.fromEntity(notification),
          });
        } catch (error) {
          batchResult.failureCount++;
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';

          batchResult.results.push({
            success: false,
            error: errorMessage,
          });

          batchResult.errors.push({
            error: errorMessage,
            index: itemIndex,
          });

          if (!continueOnError) {
            throw error;
          }
        }
      }
    });

    return batchResult;
  }

  /**
   * Process a batch of update operations
   */
  private async processBulkUpdateBatch(
    updates: Array<{ id: string; data: UpdateNotificationDto }>,
    batchIndex: number,
    continueOnError: boolean,
  ): Promise<BulkOperationResult<NotificationResponseDto>> {
    const batchResult: BulkOperationResult<NotificationResponseDto> = {
      totalCount: updates.length,
      successCount: 0,
      failureCount: 0,
      duration: 0,
      results: [],
      errors: [],
    };

    this.logger.debug(`Processing update batch ${batchIndex}`, {
      batchSize: updates.length,
    });

    for (const [itemIndex, update] of updates.entries()) {
      try {
        // Get existing notification
        const notification = await this.dataAccess.findById(update.id);

        // Validate update is allowed
        this.businessLogic.validateUpdateAllowed(notification);

        // Prepare update data
        const updateData = this.businessLogic.prepareUpdateData(
          update.data,
          notification,
        );

        // Determine if requeuing is needed
        const shouldRequeue = this.businessLogic.shouldRequeue(
          notification.scheduledFor,
          updateData.scheduledFor || null,
        );

        // Update using orchestration service
        const updatedNotification = await this.orchestration.updateNotification(
          update.id,
          updateData,
          shouldRequeue,
        );

        batchResult.successCount++;
        batchResult.results.push({
          id: update.id,
          success: true,
          data: NotificationResponseDto.fromEntity(updatedNotification),
        });
      } catch (error) {
        batchResult.failureCount++;
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';

        batchResult.results.push({
          id: update.id,
          success: false,
          error: errorMessage,
        });

        batchResult.errors.push({
          entityId: update.id,
          error: errorMessage,
          index: itemIndex,
        });

        if (!continueOnError) {
          throw error;
        }
      }
    }

    return batchResult;
  }

  /**
   * Create batches from array
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    return batches;
  }

  /**
   * Publish bulk operation completed event
   */
  private async publishBulkOperationEvent(
    operationType: 'create' | 'update' | 'cancel' | 'retry',
    result: BulkOperationResult,
  ): Promise<void> {
    try {
      const event = this.eventBus.createEvent<BulkOperationCompletedEvent>(
        'BulkOperationCompleted',
        'bulk-operation',
        'BulkOperation',
        {
          operationType,
          totalCount: result.totalCount,
          successCount: result.successCount,
          failureCount: result.failureCount,
          completedAt: new Date(),
          duration: result.duration,
          errors: result.errors,
        },
      );

      await this.eventBus.publish(event);
    } catch (error) {
      this.logger.error('Failed to publish bulk operation event', {
        operationType,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Invalidate notification caches
   */
  private async invalidateNotificationCaches(
    notificationIds: string[],
  ): Promise<void> {
    try {
      const cacheKeys = notificationIds.map(
        (id) => `notification:${id}:status`,
      );
      await this.cacheService.mdel(cacheKeys);
    } catch (error) {
      this.logger.warn('Failed to invalidate notification caches', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Invalidate stats cache
   */
  private async invalidateStatsCache(): Promise<void> {
    try {
      await this.cacheService.clear('stats:*');
    } catch (error) {
      this.logger.warn('Failed to invalidate stats cache', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

/**
 * Simple semaphore implementation for controlling parallelism
 */
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.permits > 0) {
        this.permits--;
        this.executeTask(task, resolve, reject);
      } else {
        this.waiting.push(() => {
          this.permits--;
          this.executeTask(task, resolve, reject);
        });
      }
    });
  }

  private async executeTask<T>(
    task: () => Promise<T>,
    resolve: (value: T) => void,
    reject: (reason: any) => void,
  ): Promise<void> {
    try {
      const result = await task();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.release();
    }
  }

  private release(): void {
    this.permits++;
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      if (next) {
        next();
      }
    }
  }
}
