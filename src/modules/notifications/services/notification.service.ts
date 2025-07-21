import { Injectable, Logger } from '@nestjs/common';
import { CreateNotificationDto } from '../dto/create-notification.dto';
import { UpdateNotificationDto } from '../dto/update-notification.dto';
import { NotificationResponseDto } from '../dto/notification-response.dto';
import { NotificationFilterDto } from '../dto/notification-filter.dto';
import { PaginatedResponseDto } from '../dto/paginated-response.dto';
import { NotificationStatsDto } from '../dto/notification-stats.dto';
import { NotificationPriority } from '../enums/notification-priority.enum';
import { NotificationStatus } from '../enums/notification-status.enum';
import { NotificationBusinessLogicService } from './notification-business-logic.service';
import { NotificationDataAccessService } from './notification-data-access.service';
import { NotificationOrchestrationService } from './notification-orchestration.service';
import { PaginationOptions } from '../../../common/repositories/base.repository';

/**
 * Refactored NotificationService - now focused on coordination and orchestration
 * Delegates business logic, data access, and orchestration to specialized services
 * This achieves better separation of concerns and smaller, more focused classes
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly businessLogic: NotificationBusinessLogicService,
    private readonly dataAccess: NotificationDataAccessService,
    private readonly orchestration: NotificationOrchestrationService,
  ) {}

  /**
   * Create a new notification
   * Coordinates validation, data preparation, and orchestration
   */
  async create(dto: CreateNotificationDto): Promise<NotificationResponseDto> {
    this.logger.log(
      `Creating notification for ${dto.recipient} via ${dto.channel}`,
    );

    try {
      // Step 1: Validate using business logic service
      await this.businessLogic.validateNotificationData(dto);

      // Step 2: Prepare data using business logic service
      const notificationData = this.businessLogic.prepareNotificationData(dto);

      // Step 3: Create and orchestrate using orchestration service
      const notification = await this.orchestration.createNotification(
        notificationData,
        NotificationPriority.NORMAL,
      );

      // Step 4: Return response DTO
      return NotificationResponseDto.fromEntity(notification);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Failed to create notification: ${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }

  /**
   * Find notification by ID
   */
  async findOne(id: string): Promise<NotificationResponseDto> {
    this.logger.log(`Finding notification ${id}`);

    const notification = await this.dataAccess.findById(id);
    return NotificationResponseDto.fromEntity(notification);
  }

  /**
   * Find all notifications with filters and pagination
   */
  async findAll(
    filterDto: NotificationFilterDto = {},
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedResponseDto<NotificationResponseDto>> {
    this.logger.log(`Finding notifications with filters`, {
      filters: filterDto,
      page,
      limit,
    });

    const pagination: PaginationOptions = { page, limit };
    const result = await this.dataAccess.findAll(filterDto, pagination);

    // Transform entities to response DTOs
    const responseData = result.data.map((notification) =>
      NotificationResponseDto.fromEntity(notification),
    );

    return PaginatedResponseDto.create(
      responseData,
      result.total,
      result.page,
      result.limit,
    );
  }

  /**
   * Update notification
   * Coordinates validation, data preparation, and persistence
   */
  async update(
    id: string,
    dto: UpdateNotificationDto,
  ): Promise<NotificationResponseDto> {
    this.logger.log(`Updating notification ${id}`);

    try {
      // Step 1: Get existing notification
      const notification = await this.dataAccess.findById(id);

      // Step 2: Validate update is allowed using business logic
      this.businessLogic.validateUpdateAllowed(notification);

      // Step 3: Prepare update data using business logic
      const updateData = this.businessLogic.prepareUpdateData(
        dto,
        notification,
      );

      // Step 4: Determine if requeuing is needed
      const shouldRequeue = this.businessLogic.shouldRequeue(
        notification.scheduledFor,
        updateData.scheduledFor || null,
      );

      // Step 5: Update using orchestration service
      const updatedNotification = await this.orchestration.updateNotification(
        id,
        updateData,
        shouldRequeue,
      );

      return NotificationResponseDto.fromEntity(updatedNotification);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `Failed to update notification ${id}: ${errorMessage}`,
        {
          notificationId: id,
          updateFields: Object.keys(dto),
        },
      );
      throw error;
    }
  }

  /**
   * Cancel notification
   */
  async cancel(id: string): Promise<NotificationResponseDto> {
    this.logger.log(`Cancelling notification ${id}`);

    try {
      // Step 1: Get existing notification
      const notification = await this.dataAccess.findById(id);

      // Step 2: Validate cancellation is allowed using business logic
      this.businessLogic.validateCancellationAllowed(notification);

      // Step 3: Cancel using orchestration service
      const cancelledNotification = await this.orchestration.cancelNotification(
        id,
        NotificationStatus.CANCELLED,
      );

      return NotificationResponseDto.fromEntity(cancelledNotification);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `Failed to cancel notification ${id}: ${errorMessage}`,
        {
          notificationId: id,
        },
      );
      throw error;
    }
  }

  /**
   * Retry failed notification
   */
  async retry(id: string): Promise<NotificationResponseDto> {
    this.logger.log(`Retrying notification ${id}`);

    try {
      // Step 1: Get existing notification
      const notification = await this.dataAccess.findById(id);

      // Step 2: Validate retry is allowed using business logic
      this.businessLogic.validateRetryAllowed(notification);

      // Step 3: Retry using orchestration service
      await this.orchestration.retryNotification(
        id,
        NotificationStatus.CREATED,
      );

      // Step 4: Get updated notification
      const retriedNotification = await this.dataAccess.findById(id);

      return NotificationResponseDto.fromEntity(retriedNotification);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(`Failed to retry notification ${id}: ${errorMessage}`, {
        notificationId: id,
      });
      throw error;
    }
  }

  /**
   * Get notification statistics
   */
  async getStats(): Promise<NotificationStatsDto> {
    this.logger.log('Generating notification statistics');

    try {
      return await this.dataAccess.getStats();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(`Failed to generate statistics: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Get notifications by status
   */
  async findByStatus(
    status: NotificationStatus,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedResponseDto<NotificationResponseDto>> {
    this.logger.log(`Finding notifications by status: ${status}`);

    const pagination: PaginationOptions = { page, limit };
    const result = await this.dataAccess.findByStatus(status, pagination);

    // Transform entities to response DTOs
    const responseData = result.data.map((notification) =>
      NotificationResponseDto.fromEntity(notification),
    );

    return PaginatedResponseDto.create(
      responseData,
      result.total,
      result.page,
      result.limit,
    );
  }

  /**
   * Get notifications by channel
   */
  async findByChannel(
    channel: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedResponseDto<NotificationResponseDto>> {
    this.logger.log(`Finding notifications by channel: ${channel}`);

    const pagination: PaginationOptions = { page, limit };
    const result = await this.dataAccess.findByChannel(channel, pagination);

    // Transform entities to response DTOs
    const responseData = result.data.map((notification) =>
      NotificationResponseDto.fromEntity(notification),
    );

    return PaginatedResponseDto.create(
      responseData,
      result.total,
      result.page,
      result.limit,
    );
  }

  /**
   * Get recent failures for monitoring
   */
  async getRecentFailures(
    minutes: number = 60,
    limit: number = 50,
  ): Promise<NotificationResponseDto[]> {
    this.logger.log(`Getting recent failures`, { minutes, limit });

    const failures = await this.dataAccess.getRecentFailures(minutes, limit);

    return failures.map((notification) =>
      NotificationResponseDto.fromEntity(notification),
    );
  }

  /**
   * Get metrics for a time period
   */
  async getMetricsForPeriod(
    startDate: Date,
    endDate: Date,
  ): Promise<{
    total: number;
    byStatus: Record<NotificationStatus, number>;
    byChannel: Record<string, number>;
  }> {
    this.logger.log('Getting metrics for time period', {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });

    return this.dataAccess.getMetricsForPeriod(startDate, endDate);
  }

  /**
   * Bulk update status for multiple notifications
   */
  async bulkUpdateStatus(
    ids: string[],
    status: NotificationStatus,
  ): Promise<{ updated: number; failed: string[] }> {
    this.logger.log(`Bulk updating status for ${ids.length} notifications`, {
      newStatus: status,
    });

    try {
      const updatedCount = await this.dataAccess.bulkUpdateStatus(ids, status);

      const failed =
        ids.length - updatedCount > 0 ? ids.slice(updatedCount) : [];

      return {
        updated: updatedCount,
        failed,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(`Failed bulk status update: ${errorMessage}`, {
        requestedIds: ids.length,
        newStatus: status,
      });
      throw error;
    }
  }

  /**
   * Check if notification exists
   */
  async exists(id: string): Promise<boolean> {
    return this.dataAccess.exists(id);
  }

  /**
   * Health check method for monitoring
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    totalNotifications: number;
    recentFailures: number;
    pendingNotifications: number;
  }> {
    this.logger.debug('Performing health check');

    try {
      const [statusCounts, recentFailures] = await Promise.all([
        this.dataAccess.countByStatus(),
        this.dataAccess.getRecentFailures(60, 100), // Last hour
      ]);

      const totalNotifications = Object.values(statusCounts).reduce(
        (sum, count) => sum + count,
        0,
      );

      const pendingNotifications =
        (statusCounts[NotificationStatus.CREATED] || 0) +
        (statusCounts[NotificationStatus.QUEUED] || 0);

      const status = recentFailures.length > 50 ? 'unhealthy' : 'healthy';

      return {
        status,
        totalNotifications,
        recentFailures: recentFailures.length,
        pendingNotifications,
      };
    } catch (error) {
      this.logger.error('Health check failed', error);

      return {
        status: 'unhealthy',
        totalNotifications: 0,
        recentFailures: 0,
        pendingNotifications: 0,
      };
    }
  }
}
