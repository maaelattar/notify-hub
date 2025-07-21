import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationStatus } from '../enums/notification-status.enum';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { Notification } from '../entities/notification.entity';

export class NotificationResponseDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Unique identifier for the notification',
  })
  id: string;

  @ApiProperty({
    enum: NotificationChannel,
    description: 'The delivery channel for the notification',
  })
  channel: NotificationChannel;

  @ApiProperty({
    example: 'user@example.com',
    description: 'The recipient identifier',
  })
  recipient: string;

  @ApiProperty({
    example: 'Welcome to NotifyHub!',
    nullable: true,
    description: 'Subject line (mainly for email notifications)',
  })
  subject: string | null;

  @ApiProperty({
    example: 'Thank you for signing up...',
    description: 'The main content of the notification',
  })
  content: string;

  @ApiProperty({
    enum: NotificationStatus,
    description: 'Current status of the notification',
  })
  status: NotificationStatus;

  @ApiProperty({
    example: { templateId: 'welcome-email', userId: '12345' },
    description: 'Additional metadata for the notification',
  })
  metadata: Record<string, any>;

  @ApiProperty({
    example: 0,
    description: 'Number of retry attempts made',
  })
  retryCount: number;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'Last error message if the notification failed',
  })
  lastError: string | null;

  @ApiProperty({
    example: '2024-01-01T00:00:00Z',
    nullable: true,
    description: 'Scheduled delivery time (ISO 8601 format)',
  })
  scheduledFor: Date | null;

  @ApiProperty({
    example: '2024-01-01T00:01:00Z',
    nullable: true,
    description: 'Timestamp when notification was sent',
  })
  sentAt: Date | null;

  @ApiProperty({
    example: '2024-01-01T00:01:30Z',
    nullable: true,
    description: 'Timestamp when notification was delivered',
  })
  deliveredAt: Date | null;

  @ApiProperty({
    example: '2024-01-01T00:00:00Z',
    description: 'Timestamp when notification was created',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2024-01-01T00:00:00Z',
    description: 'Timestamp when notification was last updated',
  })
  updatedAt: Date;

  @ApiPropertyOptional({
    description: 'HATEOAS links for resource actions',
    example: {
      self: { href: '/api/v1/notifications/123', method: 'GET' },
      update: { href: '/api/v1/notifications/123', method: 'PATCH' },
      cancel: { href: '/api/v1/notifications/123', method: 'DELETE' },
      retry: { href: '/api/v1/notifications/123/retry', method: 'POST' },
    },
  })
  _links?: Record<string, { href: string; method: string }>;

  static fromEntity(entity: Notification): NotificationResponseDto {
    const dto = new NotificationResponseDto();
    Object.assign(dto, entity);
    return dto;
  }

  static withLinks(notification: Notification): NotificationResponseDto {
    const dto = NotificationResponseDto.fromEntity(notification);
    dto._links = {
      self: {
        href: `/api/v1/notifications/${notification.id}`,
        method: 'GET',
      },
    };

    // Add conditional links based on status
    if (
      notification.status === NotificationStatus.CREATED ||
      notification.status === NotificationStatus.QUEUED
    ) {
      dto._links.update = {
        href: `/api/v1/notifications/${notification.id}`,
        method: 'PATCH',
      };
      dto._links.cancel = {
        href: `/api/v1/notifications/${notification.id}`,
        method: 'DELETE',
      };
    }

    if (notification.status === NotificationStatus.FAILED) {
      dto._links.retry = {
        href: `/api/v1/notifications/${notification.id}/retry`,
        method: 'POST',
      };
    }

    return dto;
  }
}
