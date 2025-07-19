import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  Repository,
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

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class NotificationRepository {
  constructor(
    @InjectRepository(Notification)
    private readonly repository: Repository<Notification>,
    private readonly configService: ConfigService,
  ) {}

  private get notificationConfig(): NotificationConfig {
    return this.configService.get<NotificationConfig>('notification')!;
  }

  async create(notification: Partial<Notification>): Promise<Notification> {
    const entity = this.repository.create(notification);
    return this.repository.save(entity);
  }

  async findById(id: string): Promise<Notification | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findAll(
    filters?: NotificationFilters,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<Notification>> {
    const where: FindOptionsWhere<Notification> = {};

    // Build where clause
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

    // Default pagination with config
    const page = pagination?.page || 1;
    const limit = Math.min(
      pagination?.limit || this.notificationConfig.defaultPageSize,
      this.notificationConfig.maxPageSize,
    );
    const skip = (page - 1) * limit;

    // Execute query
    const [data, total] = await this.repository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
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
