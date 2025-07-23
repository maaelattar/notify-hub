import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationRepository } from '../repositories/notification.repository';
import { Notification } from '../entities/notification.entity';
import { NotificationFilterDto } from '../dto/notification-filter.dto';
import { PaginatedResponseDto } from '../dto/paginated-response.dto';
import { NotificationStatsDto } from '../dto/notification-stats.dto';
import { PaginationOptions } from '../../../common/repositories/base.repository';
import { Pagination } from '../../../common/value-objects/pagination.vo';
import { NotificationConfiguration } from '../../../common/types/notification.types';
import { NotificationStatus } from '../enums/notification-status.enum';

@Injectable()
export class NotificationQueryService {
  private readonly logger = new Logger(NotificationQueryService.name);
  private readonly config: NotificationConfiguration;

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly configService: ConfigService,
  ) {
    this.config =
      this.configService.get<NotificationConfiguration>('notification')!;
  }

  async findById(id: string): Promise<Notification> {
    this.logger.debug(`Finding notification by ID: ${id}`);
    const notification = await this.notificationRepository.findById(id);
    if (!notification) {
      this.logger.warn(`Notification not found`, { notificationId: id });
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }
    return notification;
  }

  async findAll(
    filters: NotificationFilterDto = {},
    pagination: PaginationOptions = {
      page: 1,
      limit: 20,
    },
  ): Promise<PaginatedResponseDto<Notification>> {
    this.logger.debug(`Finding notifications with filters`, {
      filters,
      pagination,
    });
    const result = await this.notificationRepository.findAll(
      filters,
      pagination,
    );
    return new PaginatedResponseDto(
      result.data,
      result.total,
      new Pagination(result.page, result.limit),
    );
  }

  async getStats(): Promise<NotificationStatsDto> {
    this.logger.debug('Generating notification statistics');

    const [statusCounts, recentFailures, pendingNotifications] =
      await Promise.all([
        this.notificationRepository.getStatusCounts(),
        this.notificationRepository.getRecentFailures(
          this.config.recentFailuresWindowMinutes,
          this.config.maxRecentFailuresDisplay,
        ),
        this.notificationRepository.findPendingNotifications(
          this.config.pendingNotificationsBatchSize,
        ),
      ]);

    const stats = new NotificationStatsDto();
    stats.statusCounts = statusCounts;
    stats.recentFailures = recentFailures.map((n) => ({
      id: n.id,
      channel: n.channel,
      error: n.lastError,
      failedAt: n.updatedAt,
    }));
    stats.pendingNotifications = pendingNotifications;

    return stats;
  }

  async findByStatus(
    status: NotificationStatus,
    pagination: PaginationOptions,
  ): Promise<PaginatedResponseDto<Notification>> {
    const filters: NotificationFilterDto = { status };
    return this.findAll(filters, pagination);
  }

  async findByChannel(
    channel: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResponseDto<Notification>> {
    const filters: NotificationFilterDto = { channel };
    return this.findAll(filters, pagination);
  }

  async getRecentFailures(
    minutes: number,
    limit: number,
  ): Promise<Notification[]> {
    return this.notificationRepository.getRecentFailures(minutes, limit);
  }

  async getMetricsForPeriod(startDate: Date, endDate: Date): Promise<any> {
    return this.notificationRepository.getMetricsForPeriod(startDate, endDate);
  }

  async exists(id: string): Promise<boolean> {
    return this.notificationRepository.exists(id);
  }
}
