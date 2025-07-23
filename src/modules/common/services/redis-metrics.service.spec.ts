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
import { ConfigService } from '@nestjs/config';
import { RedisMetricsService } from '../../monitoring/services/redis-metrics.service';
import { RedisProvider } from '../providers/redis.provider';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import {
  MockFactory,
  MockRedisClient,
  MockRedisProvider,
} from '../../../test/mock-types';

describe('RedisMetricsService', () => {
  let service: RedisMetricsService;
  let mockRedisClient: MockRedisClient;
  let mockRedisProvider: MockRedisProvider;

  beforeEach(async () => {
    mockRedisClient = MockFactory.createMockRedisClient();
    mockRedisProvider = MockFactory.createMockRedisProvider();
    mockRedisProvider.getClient.mockReturnValue(mockRedisClient);

    // Create service instance directly with mocked dependencies
    service = new RedisMetricsService(mockRedisProvider as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('recordNotificationSent', () => {
    it('should record a sent notification', async () => {
      await service.recordNotificationSent(
        'email',
        NotificationPriority.HIGH,
        150,
      );

      expect(mockRedisClient.pipeline).toHaveBeenCalled();
      const pipeline = mockRedisClient.pipeline();
      expect(pipeline.hincrby).toHaveBeenCalled();
      expect(pipeline.expire).toHaveBeenCalled();
      expect(pipeline.exec).toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedisClient.pipeline.mockReturnValue({
        hincrby: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        lpush: vi.fn().mockReturnThis(),
        ltrim: vi.fn().mockReturnThis(),
        exec: vi.fn().mockRejectedValue(new Error('Redis error')),
      });

      await expect(
        service.recordNotificationSent('email', NotificationPriority.HIGH, 150),
      ).resolves.not.toThrow();
    });
  });

  describe('recordNotificationFailed', () => {
    it('should record a failed notification', async () => {
      await service.recordNotificationFailed(
        NotificationPriority.NORMAL,
        'Connection timeout',
        'sms',
      );

      expect(mockRedisClient.pipeline).toHaveBeenCalled();
      const pipeline = mockRedisClient.pipeline();
      expect(pipeline.hincrby).toHaveBeenCalled();
      expect(pipeline.expire).toHaveBeenCalled();
    });
  });

  describe('getMetrics', () => {
    it('should return overall statistics', async () => {
      // Mock Redis responses for multiple calls
      mockRedisClient.hgetall
        .mockResolvedValue({
          total: '10',
          'channel:email': '8',
          'priority:HIGH': '5',
        })
        .mockResolvedValue({
          total: '2',
          'channel:email': '1',
          'priority:HIGH': '1',
        });

      mockRedisClient.llen.mockResolvedValue(3);
      mockRedisClient.lrange.mockResolvedValue(['100', '150', '200']);

      const stats = await service.getMetrics();

      expect(stats).toBeDefined();
      expect(stats.notificationsSent).toBeGreaterThanOrEqual(0);
      expect(stats.notificationsFailed).toBeGreaterThanOrEqual(0);
      expect(stats.successRate).toBeGreaterThanOrEqual(0);
      expect(stats.successRate).toBeLessThanOrEqual(1);
    });

    it('should handle empty data gracefully', async () => {
      mockRedisClient.hgetall.mockResolvedValue({});
      mockRedisClient.llen.mockResolvedValue(0);
      mockRedisClient.lrange.mockResolvedValue([]);

      const stats = await service.getMetrics();

      expect(stats).toEqual({
        notificationsSent: 0,
        notificationsFailed: 0,
        averageProcessingTime: 0,
        successRate: 0,
        channelBreakdown: {},
        priorityBreakdown: {},
      });
    });
  });

  describe('recordChannelDelivery', () => {
    it('should record channel delivery metrics', async () => {
      await service.recordChannelDelivery('email', true, 120);

      expect(mockRedisClient.pipeline).toHaveBeenCalled();
      const pipeline = mockRedisClient.pipeline();
      expect(pipeline.hincrby).toHaveBeenCalled();
      expect(pipeline.expire).toHaveBeenCalled();
    });
  });

  describe('resetMetrics', () => {
    it('should clear all metrics', async () => {
      mockRedisClient.keys = vi
        .fn()
        .mockResolvedValueOnce(['metrics:2024-01-01-10:sent'])
        .mockResolvedValueOnce(['metrics:2024-01-01-10:failed'])
        .mockResolvedValueOnce(['processing_times:2024-01-01-10']);
      mockRedisClient.del = vi.fn().mockResolvedValue(3);

      await service.resetMetrics();

      expect(mockRedisClient.keys).toHaveBeenCalledTimes(3);
      expect(mockRedisClient.del).toHaveBeenCalled();
    });
  });

  describe('healthCheck', () => {
    it('should return health status', async () => {
      const mockRedisProvider = {
        getClient: vi.fn().mockReturnValue(mockRedisClient),
        ping: vi.fn().mockResolvedValue('PONG'),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RedisMetricsService,
          { provide: RedisProvider, useValue: mockRedisProvider },
        ],
      }).compile();

      const healthService =
        module.get<RedisMetricsService>(RedisMetricsService);
      const health = await healthService.healthCheck();

      expect(health).toBeDefined();
      expect(health.redis).toBeDefined();
    });
  });
});
