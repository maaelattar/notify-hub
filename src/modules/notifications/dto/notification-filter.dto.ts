import { IsEnum, IsOptional, IsString, IsNumberString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { NotificationStatus } from '../enums/notification-status.enum';
import { NotificationChannel } from '../enums/notification-channel.enum';

export class NotificationFilterDto {
  @ApiPropertyOptional({
    enum: NotificationStatus,
    description: 'Filter by notification status',
  })
  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;

  @ApiPropertyOptional({
    enum: NotificationChannel,
    description: 'Filter by notification channel',
  })
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @ApiPropertyOptional({
    example: 'user@example.com',
    description: 'Filter by recipient identifier',
  })
  @IsOptional()
  @IsString()
  recipient?: string;

  @ApiPropertyOptional({
    example: '1',
    default: '1',
    description: 'Page number for pagination',
  })
  @IsOptional()
  @IsNumberString()
  @Transform(({ value }) => (value ? parseInt(value as string, 10) : 1))
  page?: number;

  @ApiPropertyOptional({
    example: '20',
    default: '20',
    description: 'Number of items per page',
  })
  @IsOptional()
  @IsNumberString()
  @Transform(({ value }) => (value ? parseInt(value as string, 10) : 20))
  limit?: number;
}
