import { NotificationChannel } from '../enums/notification-channel.enum';
import { NotificationPriority } from '../enums/notification-priority.enum';
import { NotificationStatus } from '../enums/notification-status.enum';
import { Notification } from '../entities/notification.entity';
import { Recipient } from '../value-objects/recipient.value-object';
import { NotificationContent } from '../value-objects/notification-content.value-object';
import {
  NotificationMetadata,
  MetadataForChannel,
} from '../../../common/types/notification.types';

/**
 * Builder pattern implementation for constructing complex notification objects
 * Provides fluent API for building notifications with validation and type safety
 * Eliminates complex constructor calls and improves code readability
 */
export class NotificationBuilder {
  private notification: Partial<Notification> = {};

  private constructor() {
    // Initialize with defaults
    this.notification.status = NotificationStatus.CREATED;
    this.notification.retryCount = 0;
    this.notification.metadata = {};
  }

  /**
   * Factory method to create a new builder instance
   */
  static create(): NotificationBuilder {
    return new NotificationBuilder();
  }

  /**
   * Factory method to create builder from existing notification (for updates)
   */
  static fromNotification(notification: Notification): NotificationBuilder {
    const builder = new NotificationBuilder();
    builder.notification = { ...notification };
    return builder;
  }

  /**
   * Set the notification channel
   */
  channel(channel: NotificationChannel): NotificationBuilder {
    this.notification.channel = channel;
    return this;
  }

  /**
   * Set the recipient using string
   */
  recipient(recipient: string): NotificationBuilder {
    this.notification.recipient = recipient;

    // Create recipient value object if channel is set
    if (this.notification.channel) {
      try {
        this.notification.recipientVO = Recipient.create(
          recipient,
          this.notification.channel,
        );
      } catch (error) {
        // Log warning but continue with legacy field
        console.warn('Failed to create recipient value object:', error);
      }
    }

    return this;
  }

  /**
   * Set the recipient using value object
   */
  recipientVO(recipientVO: Recipient): NotificationBuilder {
    this.notification.recipientVO = recipientVO;
    this.notification.recipient = recipientVO.getValue();
    return this;
  }

  /**
   * Set the subject
   */
  subject(subject: string): NotificationBuilder {
    this.notification.subject = subject;
    return this;
  }

  /**
   * Set the content using string
   */
  content(content: string): NotificationBuilder {
    this.notification.content = content;

    // Create content value object if channel is set
    if (this.notification.channel) {
      try {
        this.notification.contentVO = NotificationContent.create(
          content,
          this.notification.channel,
        );
      } catch (error) {
        // Log warning but continue with legacy field
        console.warn('Failed to create content value object:', error);
      }
    }

    return this;
  }

  /**
   * Set the content using value object
   */
  contentVO(contentVO: NotificationContent): NotificationBuilder {
    this.notification.contentVO = contentVO;
    this.notification.content = contentVO.getValue();
    return this;
  }

  /**
   * Set metadata with type safety based on channel
   */
  metadata<T extends NotificationChannel>(
    channel: T,
    metadata: MetadataForChannel<T>,
  ): NotificationBuilder;
  metadata(metadata: NotificationMetadata): NotificationBuilder;
  metadata(
    channelOrMetadata: NotificationChannel | NotificationMetadata,
    metadata?: NotificationMetadata,
  ): NotificationBuilder {
    if (typeof channelOrMetadata === 'string' && metadata) {
      // Type-safe metadata setting
      this.notification.metadata = metadata;
    } else {
      // Generic metadata setting
      this.notification.metadata = channelOrMetadata as NotificationMetadata;
    }
    return this;
  }

  /**
   * Add metadata field
   */
  addMetadata(key: string, value: any): NotificationBuilder {
    if (!this.notification.metadata) {
      this.notification.metadata = {};
    }
    (this.notification.metadata as any)[key] = value;
    return this;
  }

  /**
   * Set scheduled delivery time
   */
  scheduledFor(date: Date): NotificationBuilder {
    this.notification.scheduledFor = date;
    return this;
  }

  /**
   * Schedule for future delivery with delay
   */
  scheduleAfter(minutes: number): NotificationBuilder {
    const scheduledDate = new Date();
    scheduledDate.setMinutes(scheduledDate.getMinutes() + minutes);
    this.notification.scheduledFor = scheduledDate;
    return this;
  }

  /**
   * Set notification status
   */
  status(status: NotificationStatus): NotificationBuilder {
    this.notification.status = status;
    return this;
  }

  /**
   * Set priority
   */
  priority(priority: NotificationPriority): NotificationBuilder {
    this.addMetadata('priorityOverride', priority);
    return this;
  }

  /**
   * Add tracking information
   */
  tracking(tracking: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmTerm?: string;
    utmContent?: string;
  }): NotificationBuilder {
    return this.addMetadata('tracking', tracking);
  }

  /**
   * Set template ID
   */
  template(
    templateId: string,
    variables?: Record<string, string | number | boolean>,
  ): NotificationBuilder {
    this.addMetadata('templateId', templateId);
    if (variables) {
      this.addMetadata('templateVariables', variables);
    }
    return this;
  }

  /**
   * Set user context
   */
  user(userId: string, organizationId?: string): NotificationBuilder {
    this.addMetadata('userId', userId);
    if (organizationId) {
      this.addMetadata('organizationId', organizationId);
    }
    return this;
  }

  /**
   * Add tags for categorization
   */
  tags(...tags: string[]): NotificationBuilder {
    const existingTags = (this.notification.metadata as any)?.tags || [];
    return this.addMetadata('tags', [...existingTags, ...tags]);
  }

  /**
   * Validate the notification before building
   */
  private validate(): void {
    const errors: string[] = [];

    // Required fields validation
    if (!this.notification.channel) {
      errors.push('Channel is required');
    }

    if (!this.notification.recipient) {
      errors.push('Recipient is required');
    }

    if (!this.notification.content) {
      errors.push('Content is required');
    }

    // Channel-specific validation
    if (
      this.notification.channel === NotificationChannel.EMAIL &&
      !this.notification.subject
    ) {
      errors.push('Subject is required for email notifications');
    }

    if (
      this.notification.channel === NotificationChannel.SMS &&
      this.notification.subject
    ) {
      errors.push('Subject is not allowed for SMS notifications');
    }

    // Recipient compatibility validation
    if (this.notification.recipientVO && this.notification.channel) {
      if (
        !this.notification.recipientVO.isCompatibleWith(
          this.notification.channel,
        )
      ) {
        errors.push(
          `Recipient is not compatible with ${this.notification.channel} channel`,
        );
      }
    }

    // Content compatibility validation
    if (this.notification.contentVO && this.notification.channel) {
      if (
        !this.notification.contentVO.isCompatibleWith(this.notification.channel)
      ) {
        errors.push(
          `Content is not compatible with ${this.notification.channel} channel`,
        );
      }
    }

    if (errors.length > 0) {
      throw new Error(`Notification validation failed: ${errors.join(', ')}`);
    }
  }

  /**
   * Build the notification object
   */
  build(): Partial<Notification> {
    this.validate();
    return { ...this.notification };
  }

  /**
   * Build and return a ready-to-save notification entity
   */
  buildEntity(): Notification {
    const notificationData = this.build();

    // Create a new notification entity with the built data
    const notification = new Notification();
    Object.assign(notification, notificationData);

    return notification;
  }

  /**
   * Clone the builder for creating variations
   */
  clone(): NotificationBuilder {
    const clonedBuilder = new NotificationBuilder();
    clonedBuilder.notification = { ...this.notification };

    // Deep clone metadata
    if (this.notification.metadata) {
      clonedBuilder.notification.metadata = JSON.parse(
        JSON.stringify(this.notification.metadata),
      );
    }

    return clonedBuilder;
  }

  /**
   * Reset the builder to start fresh
   */
  reset(): NotificationBuilder {
    this.notification = {};
    this.notification.status = NotificationStatus.CREATED;
    this.notification.retryCount = 0;
    this.notification.metadata = {};
    return this;
  }
}

/**
 * Convenience factory functions for common notification types
 */
export class NotificationFactory {
  /**
   * Create an email notification builder
   */
  static email(
    recipient: string,
    subject: string,
    content: string,
  ): NotificationBuilder {
    return NotificationBuilder.create()
      .channel(NotificationChannel.EMAIL)
      .recipient(recipient)
      .subject(subject)
      .content(content);
  }

  /**
   * Create an SMS notification builder
   */
  static sms(phoneNumber: string, content: string): NotificationBuilder {
    return NotificationBuilder.create()
      .channel(NotificationChannel.SMS)
      .recipient(phoneNumber)
      .content(content);
  }

  /**
   * Create a webhook notification builder
   */
  static webhook(url: string, content: string): NotificationBuilder {
    return NotificationBuilder.create()
      .channel(NotificationChannel.WEBHOOK)
      .recipient(url)
      .content(content);
  }

  /**
   * Create a push notification builder
   */
  static push(deviceToken: string, content: string): NotificationBuilder {
    return NotificationBuilder.create()
      .channel(NotificationChannel.PUSH)
      .recipient(deviceToken)
      .content(content);
  }

  /**
   * Create a marketing email with common settings
   */
  static marketingEmail(
    recipient: string,
    subject: string,
    content: string,
    campaign: string,
  ): NotificationBuilder {
    return NotificationFactory.email(recipient, subject, content)
      .tracking({
        utmSource: 'email',
        utmMedium: 'marketing',
        utmCampaign: campaign,
      })
      .tags('marketing', campaign)
      .template('marketing-template');
  }

  /**
   * Create a transactional email with common settings
   */
  static transactionalEmail(
    recipient: string,
    subject: string,
    content: string,
    userId: string,
  ): NotificationBuilder {
    return NotificationFactory.email(recipient, subject, content)
      .user(userId)
      .priority(NotificationPriority.HIGH)
      .tags('transactional')
      .template('transactional-template');
  }

  /**
   * Create a scheduled reminder
   */
  static reminder(
    channel: NotificationChannel,
    recipient: string,
    content: string,
    delayMinutes: number,
  ): NotificationBuilder {
    return NotificationBuilder.create()
      .channel(channel)
      .recipient(recipient)
      .content(content)
      .scheduleAfter(delayMinutes)
      .tags('reminder')
      .priority(NotificationPriority.NORMAL);
  }
}
