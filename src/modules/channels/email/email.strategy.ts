import { Injectable } from '@nestjs/common';
import { Notification } from '../../notifications/entities/notification.entity';
import { NotificationChannel } from '../../notifications/enums/notification-channel.enum';
import { ChannelResult } from '../interfaces/channel.interface';
import { BaseChannel } from '../base/base.channel';
import { EmailService } from './services/email.service';
import { ChannelStrategy } from '../decorators/channel-strategy.decorator';

@Injectable()
@ChannelStrategy(NotificationChannel.EMAIL)
export class EmailChannelStrategy extends BaseChannel {
  name = NotificationChannel.EMAIL;

  constructor(private readonly emailService: EmailService) {
    super();
  }

  async send(notification: Notification): Promise<ChannelResult> {
    const result = await this.emailService.sendNotification(notification);
    return {
      success: result.success,
      channel: this.name,
      messageId: result.messageId,
      error: result.error,
      details: {
        previewUrl: result.previewUrl,
        envelope: result.envelope,
      },
      deliveredAt: result.success ? new Date() : undefined,
    };
  }

  async isAvailable(): Promise<boolean> {
    return this.emailService.verify();
  }

  validateRecipient(recipient: string): boolean {
    const emailRegex = /^[^
@]+@[^
@]+\.[^
@]+$/;
    return emailRegex.test(recipient);
  }
}
