import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationRepository } from '../repositories/notification.repository';
import { Notification } from '../entities/notification.entity';
import { NotificationStatus } from '../enums/notification-status.enum';
import { NotificationFilters } from '../dto/notification-filter.dto';
import { PaginatedResponseDto } from '../dto/paginated-response.dto';
import { NotificationStatsDto } from '../dto/notification-stats.dto';
import { PaginationOptions } from '../../../common/repositories/base.repository';
import { NotificationConfiguration } from '../../../common/types/notification.types';

/**
 * Service responsible for all data access operations for notifications
 * Handles CRUD operations, queries, statistics, and data retrieval
 * Separated from business logic and orchestration concerns
 */
@Injectable()
export class NotificationDataAccessService {
  private readonly logger = new Logger(NotificationDataAccessService.name);
  private readonly config: NotificationConfiguration;

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly configService: ConfigService,
  ) {
    this.config =
      this.configService.get<NotificationConfiguration>('notification')!;
  }

  /**
   * Find notification by ID with error handling
   */
  async findById(id: string): Promise<Notification> {
    this.logger.debug(`Finding notification by ID: ${id}`);

    const notification = await this.notificationRepository.findById(id);

    if (!notification) {
      this.logger.warn(`Notification not found`, { notificationId: id });
      throw new NotFoundException({
        message: 'Notification not found',
        context: { notificationId: id },
      });
    }

    return notification;
  }

  /**
   * Find notification by ID, return null if not found
   */
  async findByIdOrNull(id: string): Promise<Notification | null> {
    this.logger.debug(`Finding notification by ID (nullable): ${id}`);
    return this.notificationRepository.findById(id);
  }

  /**
   * Find all notifications with filters and pagination
   */
  async findAll(
    filters: NotificationFilters = {},
    pagination: PaginationOptions = {
      page: 1,
      limit: this.config.defaultPageSize,
    },
  ): Promise<PaginatedResponseDto<Notification>> {
    this.logger.debug(`Finding notifications with filters`, {
      filters: this.sanitizeFilters(filters),
      pagination,
    });

    const result = await this.notificationRepository.findAll(
      filters,
      pagination,
    );

    return PaginatedResponseDto.create(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }

  /**
   * Create a new notification entity
   */
  async create(notificationData: Partial<Notification>): Promise<Notification> {
    this.logger.debug(`Creating notification entity`, {
      channel: notificationData.channel,
      recipient: this.maskSensitiveData(notificationData.recipient ?? ''),
      hasSchedule: !!notificationData.scheduledFor,
    });

    return this.notificationRepository.create(notificationData);
  }

  /**
   * Update notification entity
   */
  async update(
    id: string,
    updateData: Partial<Notification>,
  ): Promise<Notification> {
    this.logger.debug(`Updating notification ${id}`, {
      fieldsToUpdate: Object.keys(updateData),
    });

    const updatedNotification = await this.notificationRepository.updateById(
      id,
      updateData,
    );

    if (!updatedNotification) {
      this.logger.warn(`Failed to update notification - not found`, {
        notificationId: id,
      });
      throw new NotFoundException({
        message: 'Notification not found for update',
        context: { notificationId: id },
      });
    }

    return updatedNotification;
  }

  /**
   * Update notification status
   */
  async updateStatus(id: string, status: NotificationStatus): Promise<void> {
    this.logger.debug(`Updating notification status`, {
      notificationId: id,
      newStatus: status,
    });

    await this.notificationRepository.updateStatus(id, status);
  }

  /**
   * Get notification statistics
   */
  async getStats(): Promise<NotificationStatsDto> {
    this.logger.debug('Generating notification statistics');

    const [statusCounts, recentFailures, pendingNotifications] =
      await Promise.all([
        this.notificationRepository.getStatusCounts(),
        this.notificationRepository.getRecentFailures(
          this.config.recentFailuresWindowMinutes,
          this.config.maxRecentFailuresDisplay,
        ),
        this.notificationRepository.getPendingNotifications(
          this.config.pendingNotificationsBatchSize,
        ),
      ]);

    const stats = new NotificationStatsDto();
    stats.statusCounts = statusCounts;
    stats.recentFailures = recentFailures;
    stats.pendingNotifications = pendingNotifications;

    this.logger.debug('Generated notification statistics', {
      totalStatuses: Object.keys(statusCounts).length,
      recentFailuresCount: recentFailures.length,
      pendingCount: pendingNotifications.length,
    });

    return stats;
  }

  /**
   * Get notifications by status
   */
  async findByStatus(
    status: NotificationStatus,
    pagination: PaginationOptions = {
      page: 1,
      limit: this.config.defaultPageSize,
    },
  ): Promise<PaginatedResponseDto<Notification>> {
    this.logger.debug(`Finding notifications by status: ${status}`, {
      pagination,
    });

    const filters: NotificationFilters = { status };
    return this.findAll(filters, pagination);
  }

  /**
   * Get notifications by channel
   */
  async findByChannel(
    channel: string,
    pagination: PaginationOptions = {
      page: 1,
      limit: this.config.defaultPageSize,
    },
  ): Promise<PaginatedResponseDto<Notification>> {
    this.logger.debug(`Finding notifications by channel: ${channel}`, {
      pagination,
    });

    const filters: NotificationFilters = { channel: channel as any };
    return this.findAll(filters, pagination);
  }

  /**
   * Get scheduled notifications that are ready to be sent
   */
  async findScheduledReady(): Promise<Notification[]> {
    this.logger.debug('Finding scheduled notifications ready for sending');

    const filters: NotificationFilters = {
      scheduledBefore: new Date(),
      status: NotificationStatus.QUEUED,
    };

    const result = await this.notificationRepository.findAll(filters, {
      page: 1,
      limit: this.config.pendingNotificationsBatchSize,
    });

    this.logger.debug(
      `Found ${result.data.length} scheduled notifications ready for sending`,
    );

    return result.data;
  }

  /**
   * Get recent failures for monitoring
   */
  async getRecentFailures(
    minutes: number = this.config.recentFailuresWindowMinutes,
    limit: number = this.config.maxRecentFailuresDisplay,
  ): Promise<Notification[]> {
    this.logger.debug(`Getting recent failures`, { minutes, limit });

    return this.notificationRepository.getRecentFailures(minutes, limit);
  }

  /**
   * Count notifications by status
   */
  async countByStatus(): Promise<Record<NotificationStatus, number>> {
    this.logger.debug('Counting notifications by status');

    return this.notificationRepository.getStatusCounts();
  }

  /**
   * Check if notification exists
   */
  async exists(id: string): Promise<boolean> {
    this.logger.debug(`Checking if notification exists: ${id}`);

    return this.notificationRepository.exists(id);
  }

  /**
   * Bulk update status for multiple notifications
   */
  async bulkUpdateStatus(
    ids: string[],
    status: NotificationStatus,
  ): Promise<number> {
    this.logger.debug(`Bulk updating status for ${ids.length} notifications`, {
      newStatus: status,
      notificationIds: ids.slice(0, 5), // Log first 5 IDs for debugging
    });

    if (ids.length === 0) {
      return 0;
    }

    // Use repository bulk update if available, otherwise update individually
    if (this.notificationRepository.bulkUpdateStatus) {
      return this.notificationRepository.bulkUpdateStatus(ids, status);
    }

    // Fallback: individual updates
    let updatedCount = 0;
    for (const id of ids) {
      try {
        await this.updateStatus(id, status);
        updatedCount++;
      } catch (error) {
        this.logger.warn(`Failed to update status for notification ${id}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return updatedCount;
  }

  /**
   * Get notification metrics for time period
   */
  async getMetricsForPeriod(
    startDate: Date,
    endDate: Date,
  ): Promise<{
    total: number;
    byStatus: Record<NotificationStatus, number>;
    byChannel: Record<string, number>;
  }> {
    this.logger.debug('Getting metrics for time period', {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });

    const filters: NotificationFilters = {
      createdAfter: startDate,
      createdBefore: endDate,
    };

    const notifications = await this.notificationRepository.findAll(filters, {
      page: 1,
      limit: 10000, // Large limit to get all results for metrics
    });

    const byStatus: Record<NotificationStatus, number> = {} as any;
    const byChannel: Record<string, number> = {};

    notifications.data.forEach((notification) => {
      // Count by status
      byStatus[notification.status] = (byStatus[notification.status] || 0) + 1;

      // Count by channel
      byChannel[notification.channel] =
        (byChannel[notification.channel] || 0) + 1;
    });

    return {
      total: notifications.total,
      byStatus,
      byChannel,
    };
  }

  /**
   * Sanitize filters for logging (remove sensitive data)
   */
  private sanitizeFilters(filters: NotificationFilters): Record<string, any> {
    const sanitized: Record<string, any> = { ...filters };

    if (sanitized.recipient) {
      sanitized.recipient = this.maskSensitiveData(sanitized.recipient);
    }

    return sanitized;
  }

  /**
   * Mask sensitive data for logging
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
