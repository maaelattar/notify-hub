import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { Notification } from '../../notifications/entities/notification.entity';
import { NotificationChannel } from '../../notifications/enums/notification-channel.enum';
import { EmailService } from '../email/services/email.service';
import { RedisMetricsService } from '../../monitoring/services/redis-metrics.service';
import {
  ChannelResult,
  INotificationChannel,
} from '../interfaces/channel.interface';

@Injectable()
export class ChannelRouter implements OnModuleInit {
  private readonly logger = new Logger(ChannelRouter.name);
  private channels: Map<NotificationChannel, INotificationChannel> = new Map();

  constructor(
    private moduleRef: ModuleRef,
    private configService: ConfigService,
    private metricsService: RedisMetricsService,
  ) {}

  onModuleInit() {
    this.registerChannels();
  }

  /**
   * Register all available channels
   */
  private registerChannels() {
    // Register Email Channel
    if (this.isChannelEnabled(NotificationChannel.EMAIL)) {
      const emailService = this.moduleRef.get(EmailService, { strict: false });
      if (emailService) {
        this.registerChannel(new EmailChannelAdapter(emailService));
      }
    }

    // Additional channels (SMS, Push, Webhook) can be registered here
    // when their implementations are available

    this.logger.log(`Registered ${this.channels.size} notification channels`);
  }

  /**
   * Register a channel
   */
  private registerChannel(channel: INotificationChannel) {
    this.channels.set(channel.name, channel);
    this.logger.log(`Registered channel: ${channel.name}`);
  }

  /**
   * Route notification to appropriate channel
   */
  async route(notification: Notification): Promise<ChannelResult> {
    const startTime = Date.now();

    try {
      // Get channel implementation
      const channel = this.channels.get(notification.channel);

      if (!channel) {
        const error = `Channel ${notification.channel} not registered`;
        this.logger.error(error);
        return {
          success: false,
          channel: notification.channel,
          error,
        };
      }

      // Check channel availability
      const isAvailable = await channel.isAvailable();
      if (!isAvailable) {
        const error = `Channel ${notification.channel} is not available`;
        this.logger.warn(error);
        return {
          success: false,
          channel: notification.channel,
          error,
        };
      }

      // Validate recipient
      if (!channel.validateRecipient(notification.recipient)) {
        const error = `Invalid recipient for ${notification.channel}: ${notification.recipient}`;
        this.logger.error(error);
        return {
          success: false,
          channel: notification.channel,
          error,
        };
      }

      // Send notification
      this.logger.log(
        `Routing notification ${notification.id} to ${notification.channel} channel`,
      );

      const result = await channel.send(notification);

      // Record metrics
      const duration = Date.now() - startTime;
      void this.metricsService.recordChannelDelivery(
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Channel routing error for ${notification.id}`,
        errorStack,
      );

      void this.metricsService.recordChannelDelivery(
        notification.channel,
        false,
        duration,
      );

      return {
        success: false,
        channel: notification.channel,
        error: errorMessage,
        details: errorStack ? { stackTrace: errorStack } : undefined,
      };
    }
  }

  /**
   * Get channel statistics
   */
  async getChannelStats(): Promise<
    Record<string, { available: boolean; enabled: boolean }>
  > {
    const stats: Record<string, { available: boolean; enabled: boolean }> = {};

    for (const [channelName, channel] of this.channels) {
      stats[channelName] = {
        available: await channel.isAvailable(),
        enabled: this.isChannelEnabled(channelName),
      };
    }

    return stats;
  }

  /**
   * Check if channel is enabled
   */
  private isChannelEnabled(channel: NotificationChannel): boolean {
    const key = `channels.${channel.toLowerCase()}.enabled`;
    return this.configService.get(key, true);
  }
}

/**
 * Email Channel Adapter
 */
class EmailChannelAdapter implements INotificationChannel {
  readonly name = NotificationChannel.EMAIL;

  constructor(private emailService: EmailService) {}

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
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(recipient);
  }
}
