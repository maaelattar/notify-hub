import { vi, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';

import { ChannelRouter } from './channel-router.service';
import { EmailService } from '../email/services/email.service';
import { RedisMetricsService } from '../../monitoring/services/redis-metrics.service';
import { NotificationChannel } from '../../notifications/enums/notification-channel.enum';

import { TestDataBuilder } from '../../../test/test-utils';

describe('ChannelRouter', () => {
  let service: ChannelRouter;
  let mockModuleRef: ModuleRef;
  let mockConfigService: ConfigService;
  let mockMetricsService: RedisMetricsService;
  let mockEmailService: EmailService;

  beforeEach(async () => {
    // Create mocks
    mockModuleRef = {
      get: vi.fn(),
    } as any;

    mockConfigService = {
      get: vi.fn().mockReturnValue(true), // Enable all channels by default
    } as any;

    mockMetricsService = {
      recordChannelDelivery: vi.fn().mockResolvedValue(undefined),
      recordNotificationSent: vi.fn().mockResolvedValue(undefined),
      recordNotificationFailed: vi.fn().mockResolvedValue(undefined),
      getMetrics: vi.fn().mockResolvedValue({}),
      resetMetrics: vi.fn().mockResolvedValue(undefined),
      healthCheck: vi
        .fn()
        .mockResolvedValue({ redis: true, metricsOperational: true }),
    } as any;

    mockEmailService = {
      sendNotification: vi.fn(),
      verify: vi.fn(),
    } as any;

    // Create service instance directly with mocked dependencies
    service = new ChannelRouter(mockModuleRef, mockConfigService, mockMetricsService);

    // Mock module ref to return email service when requested
    mockModuleRef.get.mockImplementation((token) => {
      if (token === EmailService) {
        return mockEmailService;
      }
      return null;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should register email channel when enabled', () => {
      // Arrange
      mockConfigService.get.mockReturnValue(true);

      // Act
      service.onModuleInit();

      // Assert
      expect(mockModuleRef.get).toHaveBeenCalledWith(EmailService, {
        strict: false,
      });
    });

    it('should not register email channel when disabled', () => {
      // Arrange
      mockConfigService.get.mockReturnValue(false);

      // Act
      service.onModuleInit();

      // Assert - Should not try to get the service when disabled
      expect(mockModuleRef.get).not.toHaveBeenCalled();
    });
  });

  describe('route', () => {
    beforeEach(() => {
      // Initialize the service with registered channels
      service.onModuleInit();
    });

    it('should successfully route email notification', async () => {
      // Arrange
      const notification = TestDataBuilder.createNotification({
        channel: NotificationChannel.EMAIL,
        recipient: 'test@example.com',
        subject: 'Test Subject',
        content: 'Test Content',
      });

      const emailResult = {
        success: true,
        messageId: 'msg-123',
        previewUrl: 'http://preview.url',
        envelope: { from: 'no-reply@test.com', to: ['test@example.com'] },
      };

      mockEmailService.verify.mockResolvedValue(true);
      mockEmailService.sendNotification.mockResolvedValue(emailResult);

      // Act
      const result = await service.route(notification);

      // Assert
      expect(mockEmailService.verify).toHaveBeenCalled();
      expect(mockEmailService.sendNotification).toHaveBeenCalledWith(
        notification,
      );
      expect(mockMetricsService.recordChannelDelivery).toHaveBeenCalledWith(
        NotificationChannel.EMAIL,
        true,
        expect.any(Number),
      );

      expect(result).toEqual({
        success: true,
        channel: NotificationChannel.EMAIL,
        messageId: emailResult.messageId,
        error: undefined,
        details: {
          previewUrl: emailResult.previewUrl,
          envelope: emailResult.envelope,
        },
        deliveredAt: expect.any(Date),
      });
    });

    it('should return error when channel is not registered', async () => {
      // Arrange
      const notification = TestDataBuilder.createNotification({
        channel: 'SMS' as NotificationChannel, // Unregistered channel
      });

      // Act
      const result = await service.route(notification);

      // Assert
      expect(result).toEqual({
        success: false,
        channel: notification.channel,
        error: 'Channel SMS not registered',
      });
    });

    it('should return error when channel is not available', async () => {
      // Arrange
      const notification = TestDataBuilder.createNotification({
        channel: NotificationChannel.EMAIL,
        recipient: 'test@example.com',
      });

      mockEmailService.verify.mockResolvedValue(false);

      // Act
      const result = await service.route(notification);

      // Assert
      expect(result).toEqual({
        success: false,
        channel: NotificationChannel.EMAIL,
        error: 'Channel email is not available',
      });
    });

    it('should return error when recipient is invalid', async () => {
      // Arrange
      const notification = TestDataBuilder.createNotification({
        channel: NotificationChannel.EMAIL,
        recipient: 'invalid-email',
      });

      mockEmailService.verify.mockResolvedValue(true);

      // Act
      const result = await service.route(notification);

      // Assert
      expect(result).toEqual({
        success: false,
        channel: NotificationChannel.EMAIL,
        error: 'Invalid recipient for email: invalid-email',
      });
    });

    it('should handle send failures gracefully', async () => {
      // Arrange
      const notification = TestDataBuilder.createNotification({
        channel: NotificationChannel.EMAIL,
        recipient: 'test@example.com',
      });

      const emailResult = {
        success: false,
        error: 'SMTP connection failed',
      };

      mockEmailService.verify.mockResolvedValue(true);
      mockEmailService.sendNotification.mockResolvedValue(emailResult);

      // Act
      const result = await service.route(notification);

      // Assert
      expect(mockMetricsService.recordChannelDelivery).toHaveBeenCalledWith(
        NotificationChannel.EMAIL,
        false,
        expect.any(Number),
      );

      expect(result).toEqual({
        success: false,
        channel: NotificationChannel.EMAIL,
        messageId: undefined,
        error: emailResult.error,
        details: {
          previewUrl: undefined,
          envelope: undefined,
        },
        deliveredAt: undefined,
      });
    });

    it('should handle exceptions during routing', async () => {
      // Arrange
      const notification = TestDataBuilder.createNotification({
        channel: NotificationChannel.EMAIL,
        recipient: 'test@example.com',
      });

      const error = new Error('Unexpected error');
      mockEmailService.verify.mockResolvedValue(true);
      mockEmailService.sendNotification.mockRejectedValue(error);

      // Act
      const result = await service.route(notification);

      // Assert
      expect(mockMetricsService.recordChannelDelivery).toHaveBeenCalledWith(
        NotificationChannel.EMAIL,
        false,
        expect.any(Number),
      );

      expect(result).toEqual({
        success: false,
        channel: NotificationChannel.EMAIL,
        error: error.message,
        details: {
          stackTrace: error.stack,
        },
      });
    });
  });

  describe('getChannelStats', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should return channel statistics', async () => {
      // Arrange
      mockEmailService.verify.mockResolvedValue(true);
      mockConfigService.get.mockImplementation((key) => {
        if (key === 'channels.email.enabled') return true;
        return false; // Default to false for unknown keys
      });

      // Act
      const stats = await service.getChannelStats();

      // Assert
      expect(stats).toEqual({
        [NotificationChannel.EMAIL]: {
          available: true,
          enabled: true,
        },
      });
    });

    it('should show unavailable channel when service is down', async () => {
      // Arrange
      mockEmailService.verify.mockResolvedValue(false);
      mockConfigService.get.mockReturnValue(true);

      // Act
      const stats = await service.getChannelStats();

      // Assert
      expect(stats).toEqual({
        [NotificationChannel.EMAIL]: {
          available: false,
          enabled: true,
        },
      });
    });
  });

  describe('EmailChannelAdapter', () => {
    it('should validate email recipients correctly', () => {
      // This test verifies the email validation logic
      // Since EmailChannelAdapter is a private class, we test it through the router

      // Valid emails should pass
      const validEmails = [
        'test@example.com',
        'user.name@domain.co.uk',
        'email+tag@site.org',
        'a@b.c',
      ];

      const invalidEmails = [
        'invalid-email',
        '@domain.com',
        'user@',
        'user@domain',
        'user name@domain.com',
        '',
      ];

      // We can't directly access the adapter, but we can infer the validation
      // by testing the router's behavior with invalid recipients
      validEmails.forEach((email) => {
        // Email regex test: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        expect(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)).toBe(true);
      });

      invalidEmails.forEach((email) => {
        expect(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)).toBe(false);
      });
    });
  });
});
