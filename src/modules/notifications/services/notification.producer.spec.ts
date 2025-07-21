import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { Queue, Job, JobOptions } from 'bull';

import {
  NotificationProducer,
  NotificationJobData,
} from './notification.producer';
import { NotificationPriority } from '../enums/notification-priority.enum';

import { TestDateUtils } from '../../../test/test-utils';

describe('NotificationProducer', () => {
  let service: NotificationProducer;
  let mockQueue: jest.Mocked<Queue<NotificationJobData>>;

  beforeEach(async () => {
    // Create mock queue
    mockQueue = {
      add: jest.fn(),
      getJob: jest.fn(),
      getJobs: jest.fn(),
      getJobCounts: jest.fn(),
      isPaused: jest.fn(),
      getWorkers: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      name: 'notifications',
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationProducer,
        {
          provide: getQueueToken('notifications'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<NotificationProducer>(NotificationProducer);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addNotificationJob', () => {
    it('should add a job to queue successfully', async () => {
      // Arrange
      const notificationId = 'test-notification-id';
      const priority = NotificationPriority.NORMAL;
      const metadata = { test: 'value' };

      const mockJob = { id: 'job-123' } as Job<NotificationJobData>;
      mockQueue.add.mockResolvedValue(mockJob);

      // Act
      const result = await service.addNotificationJob(
        notificationId,
        priority,
        undefined,
        metadata,
      );

      // Assert
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-notification',
        {
          notificationId,
          priority,
          metadata,
        },
        expect.objectContaining({
          priority: 5, // Normal priority
          attempts: 3,
          timeout: 30000,
          removeOnComplete: { age: 3600, count: 100 },
          removeOnFail: false,
          backoff: { type: 'exponential', delay: 2000 },
        }),
      );

      expect(result).toBe('job-123');
    });

    it('should add high priority job with correct options', async () => {
      // Arrange
      const notificationId = 'high-priority-notification';
      const priority = NotificationPriority.HIGH;

      const mockJob = { id: 'high-job-123' } as Job<NotificationJobData>;
      mockQueue.add.mockResolvedValue(mockJob);

      // Act
      const result = await service.addNotificationJob(notificationId, priority);

      // Assert
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-notification',
        {
          notificationId,
          priority,
          metadata: undefined,
        },
        expect.objectContaining({
          priority: 1, // High priority
          lifo: true,
          attempts: 5, // More retries for high priority
          backoff: { type: 'exponential', delay: 1000 },
        }),
      );

      expect(result).toBe('high-job-123');
    });

    it('should add low priority job with correct options', async () => {
      // Arrange
      const notificationId = 'low-priority-notification';
      const priority = NotificationPriority.LOW;

      const mockJob = { id: 'low-job-123' } as Job<NotificationJobData>;
      mockQueue.add.mockResolvedValue(mockJob);

      // Act
      const result = await service.addNotificationJob(notificationId, priority);

      // Assert
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-notification',
        expect.any(Object),
        expect.objectContaining({
          priority: 10, // Low priority
          attempts: 2, // Fewer retries for low priority
          backoff: { type: 'exponential', delay: 5000 },
        }),
      );

      expect(result).toBe('low-job-123');
    });

    it('should add scheduled job with delay', async () => {
      // Arrange
      const notificationId = 'scheduled-notification';
      const scheduledFor = TestDateUtils.futureDate(60); // 1 hour from now
      const expectedDelay = scheduledFor.getTime() - Date.now();

      const mockJob = { id: 'scheduled-job-123' } as Job<NotificationJobData>;
      mockQueue.add.mockResolvedValue(mockJob);

      // Act
      const result = await service.addNotificationJob(
        notificationId,
        NotificationPriority.NORMAL,
        scheduledFor,
      );

      // Assert
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-notification',
        expect.any(Object),
        expect.objectContaining({
          delay: expect.any(Number), // Should have delay
        }),
      );

      // Check that delay is approximately correct (within 1 second tolerance)
      const actualDelay = (mockQueue.add.mock.calls[0][2] as JobOptions).delay!;
      expect(Math.abs(actualDelay - expectedDelay)).toBeLessThan(1000);

      expect(result).toBe('scheduled-job-123');
    });

    it('should not add delay for past scheduled dates', async () => {
      // Arrange
      const notificationId = 'past-notification';
      const scheduledFor = TestDateUtils.pastDate(60); // 1 hour ago

      const mockJob = { id: 'past-job-123' } as Job<NotificationJobData>;
      mockQueue.add.mockResolvedValue(mockJob);

      // Act
      const result = await service.addNotificationJob(
        notificationId,
        NotificationPriority.NORMAL,
        scheduledFor,
      );

      // Assert
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-notification',
        expect.any(Object),
        expect.not.objectContaining({
          delay: expect.any(Number),
        }),
      );

      expect(result).toBe('past-job-123');
    });

    it('should use default priority when not specified', async () => {
      // Arrange
      const notificationId = 'default-notification';

      const mockJob = { id: 'default-job-123' } as Job<NotificationJobData>;
      mockQueue.add.mockResolvedValue(mockJob);

      // Act
      const result = await service.addNotificationJob(notificationId);

      // Assert
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-notification',
        {
          notificationId,
          priority: NotificationPriority.NORMAL,
          metadata: undefined,
        },
        expect.any(Object),
      );

      expect(result).toBe('default-job-123');
    });

    it('should throw error when queue add fails', async () => {
      // Arrange
      const notificationId = 'failing-notification';
      const error = new Error('Queue connection failed');
      mockQueue.add.mockRejectedValue(error);

      // Act & Assert
      await expect(service.addNotificationJob(notificationId)).rejects.toThrow(
        'Failed to queue notification: Queue connection failed',
      );
    });
  });

  describe('addBulkNotificationJobs', () => {
    it('should add multiple jobs successfully', async () => {
      // Arrange
      const notifications = [
        { id: 'notification-1', priority: NotificationPriority.HIGH },
        { id: 'notification-2', priority: NotificationPriority.NORMAL },
        { id: 'notification-3', priority: NotificationPriority.LOW },
      ];

      const mockJobs = [
        { id: 'job-1' },
        { id: 'job-2' },
        { id: 'job-3' },
      ] as Job<NotificationJobData>[];

      mockQueue.add
        .mockResolvedValueOnce(mockJobs[0])
        .mockResolvedValueOnce(mockJobs[1])
        .mockResolvedValueOnce(mockJobs[2]);

      // Act
      const result = await service.addBulkNotificationJobs(notifications);

      // Assert
      expect(mockQueue.add).toHaveBeenCalledTimes(3);
      expect(result).toEqual(['job-1', 'job-2', 'job-3']);
    });

    it('should use default priority for notifications without priority', async () => {
      // Arrange
      const notifications = [
        { id: 'notification-1' }, // No priority specified
        { id: 'notification-2', priority: NotificationPriority.HIGH },
      ];

      const mockJobs = [
        { id: 'job-1' },
        { id: 'job-2' },
      ] as Job<NotificationJobData>[];

      mockQueue.add
        .mockResolvedValueOnce(mockJobs[0])
        .mockResolvedValueOnce(mockJobs[1]);

      // Act
      const result = await service.addBulkNotificationJobs(notifications);

      // Assert
      expect(mockQueue.add).toHaveBeenNthCalledWith(
        1,
        'process-notification',
        {
          notificationId: 'notification-1',
          priority: NotificationPriority.NORMAL, // Should use default
          metadata: undefined,
        },
        expect.any(Object),
      );

      expect(result).toEqual(['job-1', 'job-2']);
    });

    it('should throw error when any job fails to add', async () => {
      // Arrange
      const notifications = [
        { id: 'notification-1' },
        { id: 'notification-2' },
      ];

      mockQueue.add
        .mockResolvedValueOnce({ id: 'job-1' } as Job<NotificationJobData>)
        .mockRejectedValueOnce(new Error('Second job failed'));

      // Act & Assert
      await expect(
        service.addBulkNotificationJobs(notifications),
      ).rejects.toThrow(
        'Failed to queue bulk notifications: Failed to queue notification: Second job failed',
      );
    });
  });

  describe('removeNotificationJob', () => {
    it('should remove job by ID successfully', async () => {
      // Arrange
      const notificationId = 'notification-to-remove';
      const mockJob = {
        remove: jest.fn().mockResolvedValue(undefined),
      } as any;

      mockQueue.getJob.mockResolvedValue(mockJob);

      // Act
      const result = await service.removeNotificationJob(notificationId);

      // Assert
      expect(mockQueue.getJob).toHaveBeenCalledWith(notificationId);
      expect(mockJob.remove).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should search pending jobs when direct lookup fails', async () => {
      // Arrange
      const notificationId = 'notification-in-pending';
      const mockJob = {
        data: { notificationId },
        remove: jest.fn().mockResolvedValue(undefined),
      } as any;

      mockQueue.getJob.mockResolvedValue(null); // Not found by ID
      mockQueue.getJobs.mockResolvedValue([mockJob]);

      // Act
      const result = await service.removeNotificationJob(notificationId);

      // Assert
      expect(mockQueue.getJob).toHaveBeenCalledWith(notificationId);
      expect(mockQueue.getJobs).toHaveBeenCalledWith([
        'waiting',
        'delayed',
        'paused',
      ]);
      expect(mockJob.remove).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when job is not found', async () => {
      // Arrange
      const notificationId = 'non-existent-notification';

      mockQueue.getJob.mockResolvedValue(null);
      mockQueue.getJobs.mockResolvedValue([]);

      // Act
      const result = await service.removeNotificationJob(notificationId);

      // Assert
      expect(result).toBe(false);
    });

    it('should throw error when removal fails', async () => {
      // Arrange
      const notificationId = 'failing-notification';
      const error = new Error('Job removal failed');

      mockQueue.getJob.mockRejectedValue(error);

      // Act & Assert
      await expect(
        service.removeNotificationJob(notificationId),
      ).rejects.toThrow(
        'Failed to remove notification from queue: Job removal failed',
      );
    });
  });

  describe('getQueueStats', () => {
    it('should return queue statistics successfully', async () => {
      // Arrange
      const mockJobCounts = {
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 1,
        paused: 0,
      };
      const mockWorkers = ['worker1', 'worker2'];

      mockQueue.getJobCounts.mockResolvedValue(mockJobCounts);
      mockQueue.isPaused.mockResolvedValue(false);
      mockQueue.getWorkers.mockResolvedValue(mockWorkers as any);

      // Act
      const result = await service.getQueueStats();

      // Assert
      expect(result).toEqual({
        name: 'notifications',
        counts: mockJobCounts,
        isPaused: false,
        workersCount: 2,
      });
    });

    it('should throw error when stats retrieval fails', async () => {
      // Arrange
      const error = new Error('Stats retrieval failed');
      mockQueue.getJobCounts.mockRejectedValue(error);

      // Act & Assert
      await expect(service.getQueueStats()).rejects.toThrow(
        'Failed to get queue statistics: Stats retrieval failed',
      );
    });
  });

  describe('pauseQueue', () => {
    it('should pause queue successfully', async () => {
      // Arrange
      mockQueue.pause.mockResolvedValue(undefined);

      // Act
      await service.pauseQueue();

      // Assert
      expect(mockQueue.pause).toHaveBeenCalled();
    });

    it('should throw error when pause fails', async () => {
      // Arrange
      const error = new Error('Pause failed');
      mockQueue.pause.mockRejectedValue(error);

      // Act & Assert
      await expect(service.pauseQueue()).rejects.toThrow(
        'Failed to pause queue: Pause failed',
      );
    });
  });

  describe('resumeQueue', () => {
    it('should resume queue successfully', async () => {
      // Arrange
      mockQueue.resume.mockResolvedValue(undefined);

      // Act
      await service.resumeQueue();

      // Assert
      expect(mockQueue.resume).toHaveBeenCalled();
    });

    it('should throw error when resume fails', async () => {
      // Arrange
      const error = new Error('Resume failed');
      mockQueue.resume.mockRejectedValue(error);

      // Act & Assert
      await expect(service.resumeQueue()).rejects.toThrow(
        'Failed to resume queue: Resume failed',
      );
    });
  });

  describe('getJob', () => {
    it('should return job when found', async () => {
      // Arrange
      const jobId = 'existing-job';
      const mockJob = { id: jobId, data: {} } as Job<NotificationJobData>;
      mockQueue.getJob.mockResolvedValue(mockJob);

      // Act
      const result = await service.getJob(jobId);

      // Assert
      expect(mockQueue.getJob).toHaveBeenCalledWith(jobId);
      expect(result).toBe(mockJob);
    });

    it('should return null when job not found', async () => {
      // Arrange
      const jobId = 'non-existent-job';
      mockQueue.getJob.mockResolvedValue(null);

      // Act
      const result = await service.getJob(jobId);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when getJob throws error', async () => {
      // Arrange
      const jobId = 'error-job';
      const error = new Error('Job retrieval failed');
      mockQueue.getJob.mockRejectedValue(error);

      // Act
      const result = await service.getJob(jobId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('buildJobOptions (private method behavior)', () => {
    it('should build correct options for different priorities', async () => {
      // Test behavior indirectly through addNotificationJob

      // High priority
      const mockJob = { id: 'test-job' } as Job<NotificationJobData>;
      mockQueue.add.mockResolvedValue(mockJob);

      await service.addNotificationJob('test', NotificationPriority.HIGH);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-notification',
        expect.any(Object),
        expect.objectContaining({
          priority: 1,
          lifo: true,
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 },
        }),
      );

      mockQueue.add.mockClear();

      // Low priority
      await service.addNotificationJob('test', NotificationPriority.LOW);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-notification',
        expect.any(Object),
        expect.objectContaining({
          priority: 10,
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
        }),
      );
    });
  });
});
