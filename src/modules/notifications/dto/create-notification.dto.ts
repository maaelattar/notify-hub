import {
  IsEnum,
  IsString,
  IsOptional,
  IsDateString,
  IsObject,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationChannel } from '../enums/notification-channel.enum';

export class CreateNotificationDto {
  @ApiProperty({
    enum: NotificationChannel,
    description: 'The channel through which to send the notification',
    example: NotificationChannel.EMAIL,
  })
  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @ApiProperty({
    description:
      'The recipient identifier (email, phone, device token, or webhook URL)',
    example: 'user@example.com',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  recipient: string;

  @ApiPropertyOptional({
    description: 'Subject line (required for email, optional for others)',
    example: 'Welcome to NotifyHub!',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @ApiProperty({
    description: 'The main content of the notification',
    example: 'Thank you for signing up. Click here to get started...',
  })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({
    description: 'Additional metadata for the notification',
    example: { templateId: 'welcome-email', userId: '12345' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({
    description:
      'Schedule the notification for future delivery (ISO 8601 format)',
    example: '2024-12-25T09:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  scheduledFor?: string;

  // Custom validation based on channel
  validate(): string[] {
    const errors: string[] = [];

    // Email validation
    if (this.channel === NotificationChannel.EMAIL) {
      if (!this.subject) {
        errors.push('Subject is required for email notifications');
      }
      if (!this.recipient.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        errors.push('Recipient must be a valid email address');
      }
    }

    // SMS validation
    if (this.channel === NotificationChannel.SMS) {
      if (!this.recipient.match(/^\+?[1-9]\d{1,14}$/)) {
        errors.push('Recipient must be a valid phone number');
      }
      if (this.content.length > 160) {
        errors.push('SMS content must be 160 characters or less');
      }
    }

    // Webhook validation
    if (this.channel === NotificationChannel.WEBHOOK) {
      try {
        new URL(this.recipient);
      } catch {
        errors.push('Recipient must be a valid URL for webhook notifications');
      }
    }

    return errors;
  }
}
