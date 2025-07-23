import { SetMetadata } from '@nestjs/common';
import { NotificationChannel } from '../../notifications/enums/notification-channel.enum';

export const CHANNEL_STRATEGY = 'CHANNEL_STRATEGY';

export const ChannelStrategy = (channel: NotificationChannel) =>
  SetMetadata(CHANNEL_STRATEGY, channel);
