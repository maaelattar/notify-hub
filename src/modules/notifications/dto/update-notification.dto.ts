import { IsOptional, IsDateString, IsObject, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  NotificationSubjectField,
  NotificationContentField,
} from '../../../common/decorators/validation.decorators';
import { NotificationMetadata } from '../../../common/types/notification.types';
import { NotificationStatus } from '../enums/notification-status.enum';

export class UpdateNotificationDto {
  @NotificationSubjectField()
  @IsOptional()
  subject?: string;

  @NotificationContentField()
  @IsOptional()
  content?: string;

  @ApiPropertyOptional({
    description: 'Channel-specific metadata for the notification',
    example: {
      templateId: 'updated-template',
      priority: 'high',
      tracking: {
        utmCampaign: 'updated-campaign',
      },
    },
  })
  @IsOptional()
  @IsObject()
  metadata?: NotificationMetadata;

  @ApiPropertyOptional({
    description: 'Update the scheduled delivery time (ISO 8601 format)',
    example: '2024-12-26T10:00:00Z',
  })
  @IsOptional()
  @IsIsoDateStringVo()
  scheduledFor?: string;

  @ApiPropertyOptional({
    enum: NotificationStatus,
    description: 'Update notification status (limited to certain transitions)',
    example: NotificationStatus.CANCELLED,
  })
  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;

  // Note: Advanced business validation for status transitions and update rules
  // is handled by NotificationBusinessLogicService
}
