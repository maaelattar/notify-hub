import { Logger } from '@nestjs/common';
import { Notification } from '../../notifications/entities/notification.entity';
import { ChannelResult, INotificationChannel } from '../interfaces/channel.interface';
import { NotificationChannel } from '../../notifications/enums/notification-channel.enum';

export abstract class BaseChannel implements INotificationChannel {
  abstract name: NotificationChannel;
  protected readonly logger: Logger;

  constructor() {
    this.logger = new Logger(this.constructor.name);
  }

  abstract send(notification: Notification): Promise<ChannelResult>;

  abstract isAvailable(): Promise<boolean>;

  abstract validateRecipient(recipient: string): boolean;
}
