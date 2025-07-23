import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

import { RedisMetricsService } from '../../monitoring/services/redis-metrics.service';
import { RedisProvider } from '../providers/redis.provider';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';

describe('RedisMetricsService', () => {
  let service: RedisMetricsService;
  let mockLogger: Logger;
  let mockRedisProvider: RedisProvider;
  let mockRedisClient: Redis;

  beforeEach(async () => {
    // Mock Redis client
    mockRedisClient = {
      pipeline: vi.fn(),
      hincrby: vi.fn(),
      lpush: vi.fn(),
      ltrim: vi.fn(),
      expire: vi.fn(),
      hgetall: vi.fn(),
      lrange: vi.fn(),
      keys: vi.fn(),
      del: vi.fn(),
      set: vi.fn(),
      get: vi.fn(),
      ping: vi.fn(),
    } as any;

    // Mock pipeline behavior
    const mockPipeline = {
      hincrby: vi.fn().mockReturnThis(),
      lpush: vi.fn().mockReturnThis(),
      ltrim: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      hgetall: vi.fn().mockReturnThis(),
      lrange: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 'OK']]),
    };
    mockRedisClient.pipeline.mockReturnValue(mockPipeline as any);

    // Mock RedisProvider
    mockRedisProvider = {
      getClient: vi.fn().mockReturnValue(mockRedisClient),
      ping: vi.fn().mockResolvedValue(true),
      isConnected: vi.fn().mockReturnValue(true),
      onModuleDestroy: vi.fn(),
    } as any;

    // Mock the logger
    mockLogger = {
      debug: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      verbose: vi.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisMetricsService,
        { provide: RedisProvider, useValue: mockRedisProvider },
      ],
    }).compile();

    service = module.get<RedisMetricsService>(RedisMetricsService);

    // Replace the logger with our mock
    (service as any).logger = mockLogger;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('recordNotificationSent', () => {
    it('should record notification sent metrics correctly', async () => {
      // Arrange
      const channel = 'email';
      const priority = NotificationPriority.NORMAL;
      const processingTime = 150;

      // Act
      await service.recordNotificationSent(channel, priority, processingTime);

      // Assert
      expect(mockRedisProvider.getClient).toHaveBeenCalled();
      expect(mockRedisClient.pipeline).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Recorded successful notification: ${channel}, ${priority}, ${processingTime}ms`,
      );
    });

    it('should accumulate multiple sent notifications', async () => {
      // Arrange & Act
      await service.recordNotificationSent(
        'email',
        NotificationPriority.NORMAL,
        100,
      );
      await service.recordNotificationSent(
        'email',
        NotificationPriority.HIGH,
        200,
      );
      await service.recordNotificationSent('sms', NotificationPriority.LOW, 50);

      // Assert - Verify Redis operations were called
      expect(mockRedisProvider.getClient).toHaveBeenCalledTimes(3);
      expect(mockRedisClient.pipeline).toHaveBeenCalledTimes(3);
    });

    it('should limit processing times to last 1000 entries', async () => {
      // Arrange & Act - Record many notifications
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 100; i++) {
        // Reduced for test performance
        promises.push(
          service.recordNotificationSent(
            'email',
            NotificationPriority.NORMAL,
            i,
          ),
        );
      }
      await Promise.all(promises);

      // Assert - Verify Redis pipeline operations with ltrim for size limit
      expect(mockRedisClient.pipeline).toHaveBeenCalled();
      const mockPipeline = mockRedisClient.pipeline() as any;
      expect(mockPipeline.ltrim).toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      // Arrange - Simulate Redis error
      mockRedisClient.pipeline.mockImplementation(() => {
        throw new Error('Redis connection failed');
      });

      // Act
      await service.recordNotificationSent(
        'email',
        NotificationPriority.NORMAL,
        100,
      );

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to record notification sent metric',
        expect.any(String),
      );
    });
  });

  describe('recordNotificationFailed', () => {
    it('should record notification failed metrics correctly', async () => {
      // Arrange
      const priority = NotificationPriority.HIGH;
      const error = 'SMTP connection failed';
      const channel = 'email';

      // Act
      await service.recordNotificationFailed(priority, error, channel);

      // Assert
      expect(mockRedisProvider.getClient).toHaveBeenCalled();
      expect(mockRedisClient.pipeline).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Recorded failed notification: ${priority}, ${error}`,
      );
    });

    it('should record failures without channel', async () => {
      // Arrange
      const priority = NotificationPriority.NORMAL;
      const error = 'Unknown error';

      // Act
      await service.recordNotificationFailed(priority, error);

      // Assert
      expect(mockRedisProvider.getClient).toHaveBeenCalled();
      expect(mockRedisClient.pipeline).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Recorded failed notification: ${priority}, ${error}`,
      );
    });

    it('should accumulate multiple failures', async () => {
      // Arrange & Act
      await service.recordNotificationFailed(
        NotificationPriority.HIGH,
        'Error 1',
        'email',
      );
      await service.recordNotificationFailed(
        NotificationPriority.HIGH,
        'Error 2',
        'email',
      );
      await service.recordNotificationFailed(
        NotificationPriority.LOW,
        'Error 3',
        'sms',
      );

      // Assert - Verify Redis operations were called
      expect(mockRedisProvider.getClient).toHaveBeenCalledTimes(3);
      expect(mockRedisClient.pipeline).toHaveBeenCalledTimes(3);
    });

    it('should handle Redis errors gracefully', async () => {
      // Arrange - Simulate Redis error
      mockRedisClient.pipeline.mockImplementation(() => {
        throw new Error('Redis connection failed');
      });

      // Act
      await service.recordNotificationFailed(
        NotificationPriority.NORMAL,
        'Test error',
        'email',
      );

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to record notification failed metric',
        expect.any(String),
      );
    });
  });

  describe('getMetrics', () => {
    it('should return correct metrics with calculations', async () => {
      // Arrange - Mock Redis pipeline exec results
      const mockPipeline = mockRedisClient.pipeline() as any;
      mockPipeline.exec.mockResolvedValue([
        [
          null,
          {
            total: '2',
            'channel:email': '2',
            'priority:NORMAL': '1',
            'priority:HIGH': '1',
          },
        ], // sent data
        [null, { total: '1', 'channel:sms': '1', 'priority:LOW': '1' }], // failed data
        [null, ['100', '200']], // processing times
      ]);

      // Act
      const metrics = await service.getMetrics();

      // Assert
      expect(metrics.notificationsSent).toBe(2);
      expect(metrics.notificationsFailed).toBe(1);
      expect(metrics.averageProcessingTime).toBe(150); // (100 + 200) / 2
      expect(metrics.successRate).toBe(66.67); // 2 / 3 * 100
      expect(metrics.channelBreakdown).toEqual({
        email: { sent: 2, failed: 0 },
        sms: { sent: 0, failed: 1 },
      });
      expect(metrics.priorityBreakdown).toEqual({
        NORMAL: { sent: 1, failed: 0 },
        HIGH: { sent: 1, failed: 0 },
        LOW: { sent: 0, failed: 1 },
      });
    });

    it('should return zero metrics when no data recorded', async () => {
      // Arrange - Mock empty Redis results
      const mockPipeline = mockRedisClient.pipeline() as any;
      mockPipeline.exec.mockResolvedValue([
        [null, null],
        [null, null],
        [null, []],
      ]);

      // Act
      const metrics = await service.getMetrics();

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

    it('should calculate 100% success rate with only successful notifications', async () => {
      // Arrange - Mock Redis pipeline exec results for only sent notifications
      const mockPipeline = mockRedisClient.pipeline() as any;
      mockPipeline.exec.mockResolvedValue([
        [null, { total: '2' }], // sent data
        [null, null], // no failed data
        [null, ['100', '150']], // processing times
      ]);

      // Act
      const metrics = await service.getMetrics();

      // Assert
      expect(metrics.successRate).toBe(100);
    });

    it('should calculate 0% success rate with only failed notifications', async () => {
      // Arrange - Mock Redis pipeline exec results for only failed notifications
      const mockPipeline = mockRedisClient.pipeline() as any;
      mockPipeline.exec.mockResolvedValue([
        [null, null], // no sent data
        [null, { total: '2' }], // failed data
        [null, []], // no processing times
      ]);

      // Act
      const metrics = await service.getMetrics();

      // Assert
      expect(metrics.successRate).toBe(0);
    });

    it('should handle Redis errors and return default metrics', async () => {
      // Arrange - Simulate Redis error
      const mockPipeline = mockRedisClient.pipeline() as any;
      mockPipeline.exec.mockRejectedValue(new Error('Redis connection failed'));

      // Act
      const metrics = await service.getMetrics();

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
    });
  });

  describe('recordChannelDelivery', () => {
    it('should record successful channel delivery', async () => {
      // Arrange
      const channel = 'email';
      const duration = 250;

      // Act
      await service.recordChannelDelivery(channel, true, duration);

      // Assert
      expect(mockRedisProvider.getClient).toHaveBeenCalled();
      expect(mockRedisClient.pipeline).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Channel delivery: ${channel}, success: true, duration: ${duration}ms`,
      );
    });

    it('should record failed channel delivery', async () => {
      // Arrange
      const channel = 'sms';
      const duration = 100;

      // Act
      await service.recordChannelDelivery(channel, false, duration);

      // Assert
      expect(mockRedisProvider.getClient).toHaveBeenCalled();
      expect(mockRedisClient.pipeline).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Channel delivery: ${channel}, success: false, duration: ${duration}ms`,
      );
    });

    it('should limit processing times to last 1000 entries', async () => {
      // Arrange & Act - Record many successful deliveries
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 100; i++) {
        // Reduced for test performance
        promises.push(service.recordChannelDelivery('email', true, i));
      }
      await Promise.all(promises);

      // Assert - Verify Redis pipeline operations with ltrim for size limit
      expect(mockRedisClient.pipeline).toHaveBeenCalled();
      const mockPipeline = mockRedisClient.pipeline() as any;
      expect(mockPipeline.ltrim).toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      // Arrange - Simulate Redis error
      mockRedisClient.pipeline.mockImplementation(() => {
        throw new Error('Redis connection failed');
      });

      // Act
      await service.recordChannelDelivery('email', true, 100);

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to record channel delivery metric',
        expect.any(String),
      );
    });
  });

  describe('resetMetrics', () => {
    it('should reset all metrics by deleting Redis keys', async () => {
      // Arrange - Mock Redis keys and del operations
      mockRedisClient.keys
        .mockResolvedValueOnce(['metrics:2025-01-01-12:sent'])
        .mockResolvedValueOnce(['metrics:2025-01-01-12:failed'])
        .mockResolvedValueOnce(['processing_times:2025-01-01-12']);
      mockRedisClient.del.mockResolvedValue(3);

      // Act
      await service.resetMetrics();

      // Assert - Verify Redis operations
      expect(mockRedisClient.keys).toHaveBeenCalledTimes(3);
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        'metrics:2025-01-01-12:sent',
        'metrics:2025-01-01-12:failed',
        'processing_times:2025-01-01-12',
      );
      expect(mockLogger.log).toHaveBeenCalledWith('Metrics reset successfully');
    });

    it('should handle Redis errors during reset', async () => {
      // Arrange - Simulate Redis error
      mockRedisClient.keys.mockRejectedValue(
        new Error('Redis keys operation failed'),
      );

      // Act
      await service.resetMetrics();

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to reset metrics',
        expect.any(String),
      );
    });
  });

  describe('healthCheck', () => {
    it('should return health status for Redis and metrics operations', async () => {
      // Arrange
      mockRedisProvider.ping.mockResolvedValue(true);
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.get.mockResolvedValue('1');
      mockRedisClient.del.mockResolvedValue(1);

      // Act
      const healthStatus = await service.healthCheck();

      // Assert
      expect(healthStatus).toEqual({
        redis: true,
        metricsOperational: true,
      });
      expect(mockRedisProvider.ping).toHaveBeenCalled();
    });

    it('should return false when Redis is not healthy', async () => {
      // Arrange
      mockRedisProvider.ping.mockResolvedValue(false);

      // Act
      const healthStatus = await service.healthCheck();

      // Assert
      expect(healthStatus).toEqual({
        redis: false,
        metricsOperational: false,
      });
    });

    it('should handle health check errors gracefully', async () => {
      // Arrange
      mockRedisProvider.ping.mockRejectedValue(new Error('Ping failed'));

      // Act
      const healthStatus = await service.healthCheck();

      // Assert
      expect(healthStatus).toEqual({
        redis: false,
        metricsOperational: false,
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Health check failed:',
        expect.any(Error),
      );
    });
  });
});
