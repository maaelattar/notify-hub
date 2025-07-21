import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';

import { MetricsService } from './metrics.service';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';

describe('MetricsService', () => {
  let service: MetricsService;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(async () => {
    // Mock the logger
    mockLogger = {
      debug: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      verbose: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsService],
    }).compile();

    service = module.get<MetricsService>(MetricsService);

    // Replace the logger with our mock
    (service as any).logger = mockLogger;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('recordNotificationSent', () => {
    it('should record notification sent metrics correctly', () => {
      // Arrange
      const channel = 'email';
      const priority = NotificationPriority.NORMAL;
      const processingTime = 150;

      // Act
      service.recordNotificationSent(channel, priority, processingTime);

      // Assert
      const metrics = service.getMetrics();
      expect(metrics.notificationsSent).toBe(1);
      expect(metrics.averageProcessingTime).toBe(150);
      expect(metrics.channelBreakdown[channel]).toEqual({
        sent: 1,
        failed: 0,
      });
      expect(metrics.priorityBreakdown[priority]).toEqual({
        sent: 1,
        failed: 0,
      });
    });

    it('should accumulate multiple sent notifications', () => {
      // Arrange & Act
      service.recordNotificationSent('email', NotificationPriority.NORMAL, 100);
      service.recordNotificationSent('email', NotificationPriority.HIGH, 200);
      service.recordNotificationSent('sms', NotificationPriority.LOW, 50);

      // Assert
      const metrics = service.getMetrics();
      expect(metrics.notificationsSent).toBe(3);
      expect(metrics.averageProcessingTime).toBe(117); // (100 + 200 + 50) / 3 = 116.67, rounded to 117
      expect(metrics.channelBreakdown['email']).toEqual({
        sent: 2,
        failed: 0,
      });
      expect(metrics.channelBreakdown['sms']).toEqual({
        sent: 1,
        failed: 0,
      });
      expect(metrics.priorityBreakdown[NotificationPriority.NORMAL]).toEqual({
        sent: 1,
        failed: 0,
      });
      expect(metrics.priorityBreakdown[NotificationPriority.HIGH]).toEqual({
        sent: 1,
        failed: 0,
      });
      expect(metrics.priorityBreakdown[NotificationPriority.LOW]).toEqual({
        sent: 1,
        failed: 0,
      });
    });

    it('should limit processing times to last 1000 entries', () => {
      // Arrange & Act - Record 1500 notifications
      for (let i = 0; i < 1500; i++) {
        service.recordNotificationSent('email', NotificationPriority.NORMAL, i);
      }

      // Assert
      const metrics = service.getMetrics();
      expect(metrics.notificationsSent).toBe(1500);
      // Should only consider last 1000 processing times: 500-1499
      // Average = (500 + 501 + ... + 1499) / 1000 = 999.5, rounded to 1000
      expect(metrics.averageProcessingTime).toBe(1000);
    });

    it('should handle errors gracefully', () => {
      // Arrange
      const originalConsole = console.error;
      console.error = jest.fn(); // Suppress error output

      // Simulate an error by corrupting internal state
      (service as any).metrics = null;

      // Act
      service.recordNotificationSent('email', NotificationPriority.NORMAL, 100);

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to record notification sent metric',
        expect.any(String),
      );

      console.error = originalConsole;
    });
  });

  describe('recordNotificationFailed', () => {
    it('should record notification failed metrics correctly', () => {
      // Arrange
      const priority = NotificationPriority.HIGH;
      const error = 'SMTP connection failed';
      const channel = 'email';

      // Act
      service.recordNotificationFailed(priority, error, channel);

      // Assert
      const metrics = service.getMetrics();
      expect(metrics.notificationsFailed).toBe(1);
      expect(metrics.channelBreakdown[channel]).toEqual({
        sent: 0,
        failed: 1,
      });
      expect(metrics.priorityBreakdown[priority]).toEqual({
        sent: 0,
        failed: 1,
      });
    });

    it('should record failures without channel', () => {
      // Arrange
      const priority = NotificationPriority.NORMAL;
      const error = 'Unknown error';

      // Act
      service.recordNotificationFailed(priority, error);

      // Assert
      const metrics = service.getMetrics();
      expect(metrics.notificationsFailed).toBe(1);
      expect(metrics.priorityBreakdown[priority]).toEqual({
        sent: 0,
        failed: 1,
      });
      // No channel breakdown should be recorded
      expect(Object.keys(metrics.channelBreakdown)).toHaveLength(0);
    });

    it('should accumulate multiple failures', () => {
      // Arrange & Act
      service.recordNotificationFailed(
        NotificationPriority.HIGH,
        'Error 1',
        'email',
      );
      service.recordNotificationFailed(
        NotificationPriority.HIGH,
        'Error 2',
        'email',
      );
      service.recordNotificationFailed(
        NotificationPriority.LOW,
        'Error 3',
        'sms',
      );

      // Assert
      const metrics = service.getMetrics();
      expect(metrics.notificationsFailed).toBe(3);
      expect(metrics.channelBreakdown['email']).toEqual({
        sent: 0,
        failed: 2,
      });
      expect(metrics.channelBreakdown['sms']).toEqual({
        sent: 0,
        failed: 1,
      });
      expect(metrics.priorityBreakdown[NotificationPriority.HIGH]).toEqual({
        sent: 0,
        failed: 2,
      });
    });

    it('should handle errors gracefully', () => {
      // Arrange
      const originalConsole = console.error;
      console.error = jest.fn();

      // Simulate an error
      (service as any).metrics = null;

      // Act
      service.recordNotificationFailed(
        NotificationPriority.NORMAL,
        'Test error',
        'email',
      );

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to record notification failed metric',
        expect.any(String),
      );

      console.error = originalConsole;
    });
  });

  describe('getMetrics', () => {
    it('should return correct metrics with calculations', () => {
      // Arrange - Record some mixed metrics
      service.recordNotificationSent('email', NotificationPriority.NORMAL, 100);
      service.recordNotificationSent('email', NotificationPriority.HIGH, 200);
      service.recordNotificationFailed(
        NotificationPriority.LOW,
        'Error',
        'sms',
      );

      // Act
      const metrics = service.getMetrics();

      // Assert
      expect(metrics).toEqual({
        notificationsSent: 2,
        notificationsFailed: 1,
        averageProcessingTime: 150, // (100 + 200) / 2
        successRate: 66.67, // 2 / 3 * 100, rounded to 2 decimal places
        channelBreakdown: {
          email: { sent: 2, failed: 0 },
          sms: { sent: 0, failed: 1 },
        },
        priorityBreakdown: {
          [NotificationPriority.NORMAL]: { sent: 1, failed: 0 },
          [NotificationPriority.HIGH]: { sent: 1, failed: 0 },
          [NotificationPriority.LOW]: { sent: 0, failed: 1 },
        },
      });
    });

    it('should return zero metrics when no data recorded', () => {
      // Act
      const metrics = service.getMetrics();

      // Assert
      expect(metrics).toEqual({
        notificationsSent: 0,
        notificationsFailed: 0,
        averageProcessingTime: 0,
        successRate: 0,
        channelBreakdown: {},
        priorityBreakdown: {},
      });
    });

    it('should calculate 100% success rate with only successful notifications', () => {
      // Arrange
      service.recordNotificationSent('email', NotificationPriority.NORMAL, 100);
      service.recordNotificationSent('sms', NotificationPriority.HIGH, 150);

      // Act
      const metrics = service.getMetrics();

      // Assert
      expect(metrics.successRate).toBe(100);
    });

    it('should calculate 0% success rate with only failed notifications', () => {
      // Arrange
      service.recordNotificationFailed(
        NotificationPriority.NORMAL,
        'Error 1',
        'email',
      );
      service.recordNotificationFailed(
        NotificationPriority.HIGH,
        'Error 2',
        'sms',
      );

      // Act
      const metrics = service.getMetrics();

      // Assert
      expect(metrics.successRate).toBe(0);
    });

    it('should handle errors and return default metrics', () => {
      // Arrange
      const originalConsole = console.error;
      console.error = jest.fn();

      // Simulate an error
      (service as any).metrics = null;

      // Act
      const metrics = service.getMetrics();

      // Assert
      expect(metrics).toEqual({
        notificationsSent: 0,
        notificationsFailed: 0,
        averageProcessingTime: 0,
        successRate: 0,
        channelBreakdown: {},
        priorityBreakdown: {},
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get metrics',
        expect.any(String),
      );

      console.error = originalConsole;
    });
  });

  describe('recordChannelDelivery', () => {
    it('should record successful channel delivery', () => {
      // Arrange
      const channel = 'email';
      const duration = 250;

      // Act
      service.recordChannelDelivery(channel, true, duration);

      // Assert
      const metrics = service.getMetrics();
      expect(metrics.channelBreakdown[channel]).toEqual({
        sent: 1,
        failed: 0,
      });
      expect(metrics.averageProcessingTime).toBe(250);
    });

    it('should record failed channel delivery', () => {
      // Arrange
      const channel = 'sms';
      const duration = 100;

      // Act
      service.recordChannelDelivery(channel, false, duration);

      // Assert
      const metrics = service.getMetrics();
      expect(metrics.channelBreakdown[channel]).toEqual({
        sent: 0,
        failed: 1,
      });
      // Processing time should not be recorded for failures
      expect(metrics.averageProcessingTime).toBe(0);
    });

    it('should limit processing times to last 1000 entries', () => {
      // Arrange & Act - Record 1500 successful deliveries
      for (let i = 0; i < 1500; i++) {
        service.recordChannelDelivery('email', true, i);
      }

      // Assert
      const metrics = service.getMetrics();
      expect(metrics.channelBreakdown['email'].sent).toBe(1500);
      // Should only consider last 1000 processing times
      expect(metrics.averageProcessingTime).toBe(1000); // Average of 500-1499
    });

    it('should handle errors gracefully', () => {
      // Arrange
      const originalConsole = console.error;
      console.error = jest.fn();

      // Simulate an error
      (service as any).metrics = null;

      // Act
      service.recordChannelDelivery('email', true, 100);

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to record channel delivery metric',
        expect.any(String),
      );

      console.error = originalConsole;
    });
  });

  describe('resetMetrics', () => {
    it('should reset all metrics to initial state', () => {
      // Arrange - Record some metrics first
      service.recordNotificationSent('email', NotificationPriority.NORMAL, 100);
      service.recordNotificationFailed(
        NotificationPriority.HIGH,
        'Error',
        'sms',
      );

      // Verify metrics exist
      let metrics = service.getMetrics();
      expect(metrics.notificationsSent).toBe(1);
      expect(metrics.notificationsFailed).toBe(1);

      // Act
      service.resetMetrics();

      // Assert
      metrics = service.getMetrics();
      expect(metrics).toEqual({
        notificationsSent: 0,
        notificationsFailed: 0,
        averageProcessingTime: 0,
        successRate: 0,
        channelBreakdown: {},
        priorityBreakdown: {},
      });

      expect(mockLogger.log).toHaveBeenCalledWith('Metrics reset successfully');
    });

    it('should handle errors during reset', () => {
      // Arrange
      const originalConsole = console.error;
      console.error = jest.fn();

      // Simulate an error by corrupting metrics
      (service as any).metrics = {
        sent: {
          clear: jest.fn(() => {
            throw new Error('Clear failed');
          }),
        },
      };

      // Act
      service.resetMetrics();

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to reset metrics',
        expect.any(String),
      );

      console.error = originalConsole;
    });
  });

  describe('integration scenarios', () => {
    it('should handle mixed operations correctly', () => {
      // Arrange & Act - Simulate a real scenario
      // Successful email notifications
      service.recordNotificationSent('email', NotificationPriority.NORMAL, 150);
      service.recordNotificationSent('email', NotificationPriority.HIGH, 100);

      // Failed SMS notification
      service.recordNotificationFailed(
        NotificationPriority.LOW,
        'Network error',
        'sms',
      );

      // Channel delivery tracking
      service.recordChannelDelivery('email', true, 120);
      service.recordChannelDelivery('sms', false, 80);

      // Assert
      const metrics = service.getMetrics();
      expect(metrics.notificationsSent).toBe(2);
      expect(metrics.notificationsFailed).toBe(1);
      expect(metrics.successRate).toBe(66.67); // 2/3 * 100
      expect(metrics.averageProcessingTime).toBe(123); // (150 + 100 + 120) / 3

      expect(metrics.channelBreakdown).toEqual({
        email: { sent: 3, failed: 0 }, // 2 from recordNotificationSent + 1 from recordChannelDelivery
        sms: { sent: 0, failed: 2 }, // 1 from recordNotificationFailed + 1 from recordChannelDelivery
      });

      expect(metrics.priorityBreakdown).toEqual({
        [NotificationPriority.NORMAL]: { sent: 1, failed: 0 },
        [NotificationPriority.HIGH]: { sent: 1, failed: 0 },
        [NotificationPriority.LOW]: { sent: 0, failed: 1 },
      });
    });
  });
});
