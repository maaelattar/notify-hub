import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DataSource,
  FindOptionsWhere,
  LessThan,
  MoreThan,
  EntityManager,
} from 'typeorm';
import { Notification } from '../entities/notification.entity';
import { NotificationStatus } from '../enums/notification-status.enum';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { NotificationConfig } from '../config/notification.config';
import {
  BaseRepository,
  PaginationOptions,
  PaginatedResult,
} from '../../../common/repositories/base.repository';
import {
  NotificationNotFoundException,
  NotificationUpdateFailedException,
  NotificationDeleteFailedException,
} from '../exceptions/notification.exceptions';

export interface NotificationFilters {
  status?: NotificationStatus;
  channel?: NotificationChannel;
  recipient?: string;
  scheduledBefore?: Date;
}

@Injectable()
export class NotificationRepository extends BaseRepository<Notification> {
  constructor(
    dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    super(dataSource, Notification);
  }

  private get notificationConfig(): NotificationConfig {
    return this.configService.get<NotificationConfig>('notification')!;
  }

  async findAll(
    filters?: NotificationFilters,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<Notification>> {
    const where: FindOptionsWhere<Notification> = {};

    // Build where clause from filters
    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.channel) {
      where.channel = filters.channel;
    }
    if (filters?.recipient) {
      where.recipient = filters.recipient;
    }
    if (filters?.scheduledBefore) {
      where.scheduledFor = LessThan(filters.scheduledBefore);
    }

    // Apply pagination limits from config
    const effectivePagination = {
      page: pagination?.page ?? 1,
      limit: Math.min(
        pagination?.limit ?? this.notificationConfig.defaultPageSize,
        this.notificationConfig.maxPageSize,
      ),
    };

    // Use base repository method with enhanced configuration
    return super.findAll(
      where,
      effectivePagination,
      { field: 'createdAt', direction: 'DESC' },
      [], // No relations needed for basic listing
    );
  }

  async update(
    id: string,
    updates: Partial<Notification>,
  ): Promise<Notification> {
    try {
      const result = await this.repository
        .createQueryBuilder()
        .update(Notification)
        .set(updates)
        .where('id = :id', { id })
        .returning('*')
        .execute();

      if (result.affected === 0) {
        throw new NotificationNotFoundException(id);
      }

      return (result.raw as Notification[])[0];
    } catch (error) {
      if (error instanceof NotificationNotFoundException) {
        throw error;
      }
      throw new NotificationUpdateFailedException(id, (error as Error).message);
    }
  }

  async updateStatus(id: string, status: NotificationStatus): Promise<void> {
    const result = await this.repository.update(id, { status });
    if (result.affected === 0) {
      throw new NotificationNotFoundException(id);
    }
  }

  async delete(id: string): Promise<void> {
    const result = await this.repository.delete(id);
    if (result.affected === 0) {
      throw new NotificationDeleteFailedException(id);
    }
  }

  // Business-specific queries
  async findPendingNotifications(limit?: number): Promise<Notification[]> {
    const batchSize =
      limit || this.notificationConfig.pendingNotificationsBatchSize;

    return this.repository.find({
      where: [
        { status: NotificationStatus.CREATED },
        { status: NotificationStatus.QUEUED },
        {
          status: NotificationStatus.FAILED,
          retryCount: LessThan(this.notificationConfig.maxRetries),
        },
      ],
      order: { createdAt: 'ASC' },
      take: batchSize,
    });
  }

  async findScheduledNotifications(before: Date): Promise<Notification[]> {
    return this.repository.find({
      where: {
        status: NotificationStatus.CREATED,
        scheduledFor: LessThan(before),
      },
      order: { scheduledFor: 'ASC' },
    });
  }

  async getStatusCounts(): Promise<Record<NotificationStatus, number>> {
    const results = await this.repository
      .createQueryBuilder('notification')
      .select('notification.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('notification.status')
      .getRawMany<{ status: NotificationStatus; count: string }>();

    return results.reduce(
      (acc, row) => {
        acc[row.status] = parseInt(row.count, 10);
        return acc;
      },
      {} as Record<NotificationStatus, number>,
    );
  }

  async getRecentFailures(
    minutes?: number,
    limit?: number,
  ): Promise<Notification[]> {
    const windowMinutes =
      minutes || this.notificationConfig.recentFailuresWindowMinutes;
    const maxLimit = limit || this.notificationConfig.maxRecentFailuresDisplay;
    const since = new Date();
    since.setMinutes(since.getMinutes() - windowMinutes);

    return this.repository.find({
      where: {
        status: NotificationStatus.FAILED,
        updatedAt: MoreThan(since),
      },
      order: { updatedAt: 'DESC' },
      take: maxLimit,
    });
  }

  // Transaction support
  async saveWithTransaction(
    notification: Notification,
    transactionManager?: EntityManager,
  ): Promise<Notification> {
    if (transactionManager) {
      return transactionManager.save(notification);
    }
    return this.repository.save(notification);
  }
}
