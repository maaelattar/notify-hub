import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { INotificationChannel, ChannelResult } from '../interfaces/channel.interface';
import { CHANNEL_STRATEGY } from '../decorators/channel-strategy.decorator';
import { Notification } from '../../notifications/entities/notification.entity';
import { NotificationChannel } from '../../notifications/enums/notification-channel.enum';
import { RedisMetricsService } from '../../monitoring/services/redis-metrics.service';

@Injectable()
export class ChannelRegistry implements OnModuleInit {
  private readonly logger = new Logger(ChannelRegistry.name);
  private readonly channels = new Map<NotificationChannel, INotificationChannel>();

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly metricsService: RedisMetricsService,
  ) {}

  onModuleInit() {
    this.registerChannels();
  }

  private registerChannels() {
    const providers = this.discoveryService.getProviders();
    for (const wrapper of providers) {
      const { instance } = wrapper;
      if (!instance || typeof instance !== 'object') {
        continue;
      }
      const prototype = Object.getPrototypeOf(instance);
      const channelType = this.reflector.get<NotificationChannel>(
        CHANNEL_STRATEGY,
        instance.constructor,
      );
      if (channelType) {
        this.channels.set(channelType, instance as INotificationChannel);
        this.logger.log(`Registered channel: ${channelType}`);
      }
    }
    this.logger.log(`Registered ${this.channels.size} notification channels`);
  }

  async route(notification: Notification): Promise<ChannelResult> {
    const startTime = Date.now();
    const channel = this.channels.get(notification.channel);

    if (!channel) {
      const error = `Channel ${notification.channel} not registered`;
      this.logger.error(error);
      return { success: false, channel: notification.channel, error };
    }

    try {
      if (!(await channel.isAvailable())) {
        const error = `Channel ${notification.channel} is not available`;
        this.logger.warn(error);
        return { success: false, channel: notification.channel, error };
      }

      if (!channel.validateRecipient(notification.recipient)) {
        const error = `Invalid recipient for ${notification.channel}: ${notification.recipient}`;
        this.logger.error(error);
        return { success: false, channel: notification.channel, error };
      }

      this.logger.log(
        `Routing notification ${notification.id} to ${notification.channel} channel`,
      );
      const result = await channel.send(notification);

      const duration = Date.now() - startTime;
      this.metricsService.recordChannelDelivery(
        notification.channel,
        result.success,
        duration,
      );

      if (result.success) {
        this.logger.log(
          `Successfully delivered notification ${notification.id} via ${notification.channel}`,
        );
      } else {
        this.logger.error(
          `Failed to deliver notification ${notification.id} via ${notification.channel}: ${result.error}`,
        );
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Channel routing error for ${notification.id}`,
        error instanceof Error ? error.stack : undefined,
      );
      this.metricsService.recordChannelDelivery(
        notification.channel,
        false,
        duration,
      );
      return { success: false, channel: notification.channel, error: errorMessage };
    }
  }
}