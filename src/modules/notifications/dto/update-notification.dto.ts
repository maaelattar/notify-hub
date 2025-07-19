import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateNotificationDto } from './create-notification.dto';
import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationStatus } from '../enums/notification-status.enum';

export class UpdateNotificationDto extends PartialType(
  OmitType(CreateNotificationDto, ['channel', 'recipient'] as const),
) {
  @ApiPropertyOptional({
    enum: NotificationStatus,
    description: 'Update the notification status',
    example: NotificationStatus.SENT,
  })
  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;
}
