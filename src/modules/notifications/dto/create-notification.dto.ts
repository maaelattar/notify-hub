import { IsEnum, IsOptional, IsDateString, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationChannel } from '../enums/notification-channel.enum';
import {
  NotificationRecipientField,
  NotificationSubjectField,
  NotificationContentField,
} from '../../../common/decorators/validation.decorators';
import { NotificationMetadata } from '../../../common/types/notification.types';

export class CreateNotificationDto {
  @ApiProperty({
    enum: NotificationChannel,
    description: 'The channel through which to send the notification',
    example: NotificationChannel.EMAIL,
  })
  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @NotificationRecipientField()
  recipient: string;

  @NotificationSubjectField()
  subject?: string;

  @NotificationContentField()
  content: string;

  @ApiPropertyOptional({
    description: 'Channel-specific metadata for the notification',
    example: {
      templateId: 'welcome-email',
      userId: '12345',
      fromName: 'NotifyHub Team',
      tracking: {
        utmSource: 'app',
        utmMedium: 'notification',
      },
    },
  })
  @IsOptional()
  @IsObject()
  metadata?: NotificationMetadata;

  @ApiPropertyOptional({
    description:
      'Schedule the notification for future delivery (ISO 8601 format)',
    example: '2024-12-25T09:00:00Z',
  })
  @IsOptional()
  @IsIsoDateStringVo()
  scheduledFor?: string;

  // Note: Advanced business validation logic is handled by NotificationValidatorService
  // This DTO provides basic format validation and type safety via custom decorators
}
