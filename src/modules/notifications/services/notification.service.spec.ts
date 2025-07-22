import { vi, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { NotificationService } from './notification.service';
import { NotificationRepository } from '../repositories/notification.repository';
import { NotificationProducer } from './notification.producer';
import { NotificationValidatorService } from './notification-validator.service';
import { NotificationOrchestrationService } from './notification-orchestration.service';
import { Notification } from '../entities/notification.entity';
import { NotificationStatus } from '../enums/notification-status.enum';
import { NotificationPriority } from '../enums/notification-priority.enum';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { UpdateNotificationDto } from '../dto/update-notification.dto';
import { NotificationFilterDto } from '../dto/notification-filter.dto';

import {
  TestDataBuilder,
  MockFactory,
  TestAssertions,
  TestDateUtils,
} from '../../../test/test-utils';
import { Pagination } from '../../../common/value-objects/pagination.vo';

describe('NotificationService', () => {
  let service: NotificationService;
  let mockBusinessLogic: any;
  let mockDataAccess: any;
  let mockOrchestration: any;
  let mockRepository: any;
  let mockNotificationRepository: any;
  let mockNotificationProducer: any;
  let mockConfig: any;

  beforeEach(() => {
    // Create simple mocks for the service dependencies
    mockBusinessLogic = {
      validateNotificationData: vi.fn().mockResolvedValue({
        isValid: true,
        criticalErrors: [],
        warningErrors: [],
        allErrors: [],
      }),
      prepareNotificationData: vi.fn().mockReturnValue({
        channel: 'email',
        recipient: 'test@example.com',
        subject: 'Test Subject',
        content: 'Test Content',
        scheduledFor: null,
        metadata: {},
      }),
      prepareUpdateData: vi.fn().mockReturnValue({
        subject: 'Updated Subject',
        content: 'Updated Content',
        scheduledFor: null,
      }),
      validateUpdateData: vi.fn().mockResolvedValue({
        isValid: true,
        criticalErrors: [],
        warningErrors: [],
        allErrors: [],
      }),
      validateUpdateAllowed: vi.fn().mockResolvedValue(true),
      validateCancellationAllowed: vi.fn().mockResolvedValue(true),
      validateRetryAllowed: vi.fn().mockResolvedValue(true),
      shouldRequeue: vi.fn().mockReturnValue(false),
      canCancel: vi.fn().mockReturnValue(true),
      canRetry: vi.fn().mockReturnValue(true),
    };

    mockDataAccess = {
      findById: vi.fn().mockResolvedValue({
        id: 'test-id',
        channel: 'email',
        recipient: 'test@example.com',
        subject: 'Test Subject',
        content: 'Test Content',
        status: 'pending',
        scheduledFor: null,
        metadata: {},
      }),
      findAll: vi.fn().mockResolvedValue({
        notifications: [],
        totalCount: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      }),
      create: vi.fn().mockResolvedValue({
        id: 'test-id',
        status: 'created',
      }),
      update: vi.fn().mockResolvedValue({
        id: 'test-id',
        status: 'updated',
      }),
      delete: vi.fn().mockResolvedValue(true),
      getStats: vi.fn().mockResolvedValue({
        pending: 5,
        sent: 10,
        failed: 2,
      }),
    };

    mockOrchestration = {
      createNotification: vi.fn().mockResolvedValue({
        id: 'test-id',
        channel: 'email',
        recipient: 'test@example.com',
        subject: 'Test Subject',
        content: 'Test Content',
        status: 'created',
        createdAt: new Date(),
      }),
      updateNotification: vi.fn().mockResolvedValue({
        id: 'test-id',
        status: 'updated',
      }),
      cancelNotification: vi.fn().mockResolvedValue({
        id: 'test-id',
        status: 'cancelled',
      }),
      retryNotification: vi.fn().mockResolvedValue({
        id: 'test-id',
        status: 'retrying',
      }),
    };

    // Legacy mocks for backward compatibility with existing tests
    mockRepository = {
      save: vi.fn(),
      update: vi.fn(),
      findOne: vi.fn(),
    };

    mockNotificationRepository = {
      updateStatus: vi.fn(),
      update: vi.fn(),
      getRecentFailures: vi.fn(),
    };

    mockNotificationProducer = {
      addNotificationJob: vi.fn(),
      removeNotificationJob: vi.fn(),
    };

    mockConfig = {
      maxRetries: 3,
      recentFailuresWindowMinutes: 30,
      maxRecentFailuresDisplay: 10,
    };

    // Create service instance directly with mocked dependencies
    service = new NotificationService(
      mockBusinessLogic,
      mockDataAccess,
      mockOrchestration,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create a notification successfully', async () => {
      // Arrange
      const createDto = TestDataBuilder.createNotificationDto({
        channel: NotificationChannel.EMAIL,
        recipient: 'test@example.com',
        subject: 'Test Subject',
        content: 'Test Content',
      });

      const savedNotification = TestDataBuilder.createNotification({
        id: 'test-id',
        channel: createDto.channel,
        recipient: createDto.recipient,
        subject: createDto.subject,
        content: createDto.content,
        status: NotificationStatus.CREATED,
      });

      // Mock validation service to return valid result
      mockBusinessLogic.validateNotificationData.mockResolvedValue({
        isValid: true,
        criticalErrors: [],
        warningErrors: [],
        allErrors: [],
      });

      // Mock orchestration service to return created notification
      mockOrchestration.createNotification.mockResolvedValue(
        savedNotification,
      );

      // Act
      const result = await service.create(createDto);

      // Assert - Orchestration service should be called with prepared data
      expect(mockOrchestration.createNotification).toHaveBeenCalledWith(
        {
          channel: createDto.channel,
          // Legacy fields for backward compatibility
          recipient: createDto.recipient,
          subject: createDto.subject,
          content: createDto.content,
          // New value object fields
          recipientVO: expect.any(Object),
          contentVO: expect.any(Object),
          metadata: {},
          scheduledFor: null,
        },
        NotificationPriority.NORMAL,
      );

      TestAssertions.assertNotificationResponse(result, {
        id: savedNotification.id,
        channel: savedNotification.channel,
        recipient: savedNotification.recipient,
        subject: savedNotification.subject,
        content: savedNotification.content,
      });
    });

    it('should create a scheduled notification', async () => {
      // Arrange
      const scheduledFor = TestDateUtils.futureDate(120);
      const createDto = TestDataBuilder.createNotificationDto({
        scheduledFor: scheduledFor.toISOString(),
      });

      const savedNotification = TestDataBuilder.createNotification({
        id: 'test-id',
        scheduledFor,
      });

      mockBusinessLogic.validateNotificationData.mockResolvedValue({
        isValid: true,
        criticalErrors: [],
        warningErrors: [],
        allErrors: [],
      });
      mockRepository.save.mockResolvedValue(savedNotification);
      mockNotificationProducer.addNotificationJob.mockResolvedValue('job-123');
      mockNotificationRepository.updateStatus.mockResolvedValue(undefined);

      // Act
      await service.create(createDto);

      // Assert
      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduledFor: scheduledFor,
        }),
      );
      expect(mockNotificationProducer.addNotificationJob).toHaveBeenCalledWith(
        savedNotification.id,
        NotificationPriority.NORMAL,
        scheduledFor,
        savedNotification.metadata,
      );
    });

    it('should throw BadRequestException when validation fails', async () => {
      // Arrange
      const createDto = TestDataBuilder.createNotificationDto();
      const validationErrors = [
        {
          field: 'recipient',
          code: 'INVALID_EMAIL_FORMAT',
          message: 'Invalid recipient format',
          context: { channel: createDto.channel },
        },
      ];

      mockBusinessLogic.validateNotificationData.mockResolvedValue({
        isValid: false,
        criticalErrors: validationErrors,
        warningErrors: [],
        allErrors: validationErrors,
      });

      // Act & Assert
      await TestAssertions.assertThrowsError(
        () => service.create(createDto),
        BadRequestException,
        'Notification validation failed',
      );

      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('should handle value object creation errors gracefully and continue with legacy fields', async () => {
      // Arrange
      const createDto = TestDataBuilder.createNotificationDto({
        recipient: 'invalid<script>recipient', // Invalid recipient that would fail value object creation
        content: 'Test content',
      });

      const savedNotification = TestDataBuilder.createNotification({
        id: 'test-id',
        recipient: createDto.recipient,
        content: createDto.content,
        status: NotificationStatus.CREATED,
      });

      mockBusinessLogic.validateNotificationData.mockResolvedValue({
        isValid: true,
        criticalErrors: [],
        warningErrors: [],
        allErrors: [],
      });
      mockRepository.save.mockResolvedValue(savedNotification);
      mockNotificationProducer.addNotificationJob.mockResolvedValue('job-123');
      mockNotificationRepository.updateStatus.mockResolvedValue(undefined);

      // Act
      const result = await service.create(createDto);

      // Assert - Should still save notification with legacy fields, null value objects
      expect(mockRepository.save).toHaveBeenCalledWith({
        channel: createDto.channel,
        recipient: createDto.recipient,
        subject: createDto.subject,
        content: createDto.content,
        recipientVO: null, // Should be null when value object creation fails
        contentVO: null, // Should be null when value object creation fails
        metadata: {},
        scheduledFor: null,
        status: NotificationStatus.CREATED,
      });

      expect(result).toBeDefined();
    });
  });

  describe('findOne', () => {
    it('should return a notification when found', async () => {
      // Arrange
      const notificationId = 'test-id';
      const notification = TestDataBuilder.createNotification({
        id: notificationId,
      });
      mockDataAccess.findById.mockResolvedValue(notification);

      // Act
      const result = await service.findOne(notificationId);

      // Assert
      expect(mockDataAccess.findById).toHaveBeenCalledWith(
        notificationId,
      );
      TestAssertions.assertNotificationResponse(result, {
        id: notificationId,
        channel: notification.channel,
        recipient: notification.recipient,
      });
    });

    it('should throw NotFoundException when notification not found', async () => {
      // Arrange
      const notificationId = 'non-existent-id';
      mockDataAccess.findById.mockResolvedValue(null);

      // Act & Assert
      await TestAssertions.assertThrowsError(
        () => service.findOne(notificationId),
        NotFoundException,
        'Notification not found',
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated notifications with default pagination', async () => {
      // Arrange
      const notifications = TestDataBuilder.createNotifications(5);
      const filters = new NotificationFilterDto();

      mockDataAccess.findAll.mockResolvedValue({
        data: notifications,
        total: 25,
        page: 1,
        limit: 20,
        totalPages: 2,
        hasNext: true,
        hasPrevious: false,
      });

      // Act
      const result = await service.findAll(filters);

      // Assert
      expect(mockDataAccess.findAll).toHaveBeenCalledWith(
        {
          status: undefined,
          channel: undefined,
          recipient: undefined,
        },
        { page: 1, limit: 20 },
      );

      TestAssertions.assertPaginatedResponse(
        result,
        notifications.map((n) =>
          expect.objectContaining({
            id: n.id,
            channel: n.channel,
            recipient: n.recipient,
          }),
        ),
        25,
        new Pagination(1, 20),
      );
    });

    it('should respect max page size limit', async () => {
      // Arrange
      const filters = new NotificationFilterDto();
      filters.pagination = new Pagination(1, 500); // Exceeds max page size

      mockDataAccess.findAll.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 100, // Should be capped at maxPageSize
        totalPages: 0,
      });

      // Act
      await service.findAll(filters);

      // Assert
      expect(mockDataAccess.findAll).toHaveBeenCalledWith(
        expect.any(Object),
        { page: 1, limit: 100 },
      );
    });

    it('should apply filters correctly', async () => {
      // Arrange
      const filters = new NotificationFilterDto();
      filters.status = NotificationStatus.SENT;
      filters.channel = NotificationChannel.EMAIL;
      filters.recipient = 'test@example.com';

      mockDataAccess.findAll.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
        hasNext: false,
        hasPrevious: false,
      });

      // Act
      await service.findAll(filters);

      // Assert
      expect(mockDataAccess.findAll).toHaveBeenCalledWith(
        {
          status: NotificationStatus.SENT,
          channel: NotificationChannel.EMAIL,
          recipient: 'test@example.com',
        },
        { page: 1, limit: 20 },
      );
    });
  });

  describe('update', () => {
    it('should update a notification successfully', async () => {
      // Arrange
      const notificationId = 'test-id';
      const updateDto = new UpdateNotificationDto();
      updateDto.subject = 'Updated Subject';
      updateDto.content = 'Updated Content';

      const existingNotification = TestDataBuilder.createNotification({
        id: notificationId,
        status: NotificationStatus.CREATED,
      });

      const updatedNotification = TestDataBuilder.createNotification({
        ...existingNotification,
        subject: updateDto.subject,
        content: updateDto.content,
      });

      mockDataAccess.findById.mockResolvedValue(
        existingNotification,
      );
      mockRepository.update.mockResolvedValue({ affected: 1 } as any);
      mockRepository.findOne.mockResolvedValue(updatedNotification);

      // Act
      const result = await service.update(notificationId, updateDto);

      // Assert
      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(mockRepository.update).toHaveBeenCalledWith(notificationId, {
        subject: updateDto.subject,
        content: updateDto.content,
        contentVO: expect.any(Object), // Should create contentVO when content is updated
      });

      TestAssertions.assertNotificationResponse(result, {
        id: notificationId,
        subject: updateDto.subject,
        content: updateDto.content,
      });
    });

    it('should throw NotFoundException when notification not found', async () => {
      // Arrange
      const notificationId = 'non-existent-id';
      const updateDto = new UpdateNotificationDto();
      mockDataAccess.findById.mockResolvedValue(null);

      // Act & Assert
      await TestAssertions.assertThrowsError(
        () => service.update(notificationId, updateDto),
        NotFoundException,
        'Notification not found',
      );
    });

    it('should throw BadRequestException when updating sent notification', async () => {
      // Arrange
      const notificationId = 'test-id';
      const updateDto = new UpdateNotificationDto();
      const sentNotification = TestDataBuilder.createNotificationWithStatus(
        NotificationStatus.SENT,
        { id: notificationId },
      );

      mockDataAccess.findById.mockResolvedValue(sentNotification);

      // Act & Assert
      await TestAssertions.assertThrowsError(
        () => service.update(notificationId, updateDto),
        BadRequestException,
        'Cannot update notifications that have been sent or delivered',
      );
    });

    it('should handle content value object creation error during update', async () => {
      // Arrange
      const notificationId = 'test-id';
      const updateDto = new UpdateNotificationDto();
      updateDto.content = '<script>alert("xss")</script>'; // Content that would fail value object creation

      const existingNotification = TestDataBuilder.createNotification({
        id: notificationId,
        status: NotificationStatus.CREATED,
        channel: NotificationChannel.EMAIL,
      });

      const updatedNotification = TestDataBuilder.createNotification({
        ...existingNotification,
        content: updateDto.content,
      });

      mockDataAccess.findById.mockResolvedValue(
        existingNotification,
      );
      mockRepository.update.mockResolvedValue({ affected: 1 } as any);
      mockRepository.findOne.mockResolvedValue(updatedNotification);

      // Act
      const result = await service.update(notificationId, updateDto);

      // Assert - Should continue with legacy content field and null contentVO
      expect(mockRepository.update).toHaveBeenCalledWith(notificationId, {
        content: updateDto.content,
        contentVO: null, // Should be null when value object creation fails
      });

      expect(result).toBeDefined();
    });

    it('should requeue notification when schedule changes', async () => {
      // Arrange
      const notificationId = 'test-id';
      const oldSchedule = TestDateUtils.futureDate(60);
      const newSchedule = TestDateUtils.futureDate(120);

      const updateDto = new UpdateNotificationDto();
      updateDto.scheduledFor = newSchedule.toISOString();

      const existingNotification = TestDataBuilder.createNotification({
        id: notificationId,
        status: NotificationStatus.CREATED,
        scheduledFor: oldSchedule,
      });

      const updatedNotification = TestDataBuilder.createNotification({
        ...existingNotification,
        scheduledFor: newSchedule,
      });

      mockDataAccess.findById.mockResolvedValue(
        existingNotification,
      );
      mockRepository.update.mockResolvedValue({ affected: 1 } as any);
      mockRepository.findOne.mockResolvedValue(updatedNotification);
      mockNotificationProducer.removeNotificationJob.mockResolvedValue(true);
      mockNotificationProducer.addNotificationJob.mockResolvedValue('job-123');
      mockNotificationRepository.updateStatus.mockResolvedValue(undefined);

      // Act
      await service.update(notificationId, updateDto);

      // Assert
      expect(
        mockNotificationProducer.removeNotificationJob,
      ).toHaveBeenCalledWith(notificationId);
      expect(mockNotificationProducer.addNotificationJob).toHaveBeenCalledWith(
        notificationId,
        NotificationPriority.NORMAL,
        newSchedule,
        { rescheduled: true },
      );
    });
  });

  describe('cancel', () => {
    it('should cancel a notification successfully', async () => {
      // Arrange
      const notificationId = 'test-id';
      const notification = TestDataBuilder.createNotification({
        id: notificationId,
        status: NotificationStatus.QUEUED,
      });

      // Mock the entity method
      notification.markAsCancelled = vi.fn().mockImplementation(() => {
        notification.status = NotificationStatus.CANCELLED;
      });

      mockDataAccess.findById.mockResolvedValue(notification);
      mockRepository.update.mockResolvedValue({ affected: 1 } as any);
      mockNotificationProducer.removeNotificationJob.mockResolvedValue(true);

      // Act
      const result = await service.cancel(notificationId);

      // Assert
      expect(notification.markAsCancelled).toHaveBeenCalled();
      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(mockRepository.update).toHaveBeenCalledWith(notificationId, {
        status: NotificationStatus.CANCELLED,
      });
      expect(
        mockNotificationProducer.removeNotificationJob,
      ).toHaveBeenCalledWith(notificationId);

      TestAssertions.assertNotificationResponse(result, {
        id: notificationId,
        status: NotificationStatus.CANCELLED,
      });
    });

    it('should throw NotFoundException when notification not found', async () => {
      // Arrange
      const notificationId = 'non-existent-id';
      mockDataAccess.findById.mockResolvedValue(null);

      // Act & Assert
      await TestAssertions.assertThrowsError(
        () => service.cancel(notificationId),
        NotFoundException,
        'Notification not found',
      );
    });

    it('should throw BadRequestException when cancellation is not allowed', async () => {
      // Arrange
      const notificationId = 'test-id';
      const notification = TestDataBuilder.createNotificationWithStatus(
        NotificationStatus.SENT,
        { id: notificationId },
      );

      notification.markAsCancelled = vi.fn().mockImplementation(() => {
        throw new Error('Cannot cancel sent notification');
      });

      mockDataAccess.findById.mockResolvedValue(notification);

      // Act & Assert
      await TestAssertions.assertThrowsError(
        () => service.cancel(notificationId),
        BadRequestException,
        'Cannot cancel notification in current state',
      );
    });
  });

  describe('retry', () => {
    it('should retry a failed notification successfully', async () => {
      // Arrange
      const notificationId = 'test-id';
      const failedNotification = TestDataBuilder.createNotificationWithStatus(
        NotificationStatus.FAILED,
        { id: notificationId, retryCount: 1 },
      );

      failedNotification.canRetry = vi.fn().mockReturnValue(true);

      mockDataAccess.findById.mockResolvedValue(failedNotification);
      mockNotificationRepository.update.mockResolvedValue(failedNotification);
      mockNotificationProducer.addNotificationJob.mockResolvedValue('job-123');
      mockNotificationRepository.updateStatus.mockResolvedValue(undefined);

      // Act
      const result = await service.retry(notificationId);

      // Assert
      expect(failedNotification.canRetry).toHaveBeenCalledWith(
        mockConfig.maxRetries,
      );
      expect(mockNotificationRepository.update).toHaveBeenCalledWith(
        notificationId,
        {
          status: NotificationStatus.CREATED,
        },
      );
      expect(mockNotificationProducer.addNotificationJob).toHaveBeenCalledWith(
        notificationId,
        NotificationPriority.HIGH,
        undefined,
        { retryAttempt: true },
      );
      expect(mockNotificationRepository.updateStatus).toHaveBeenCalledWith(
        notificationId,
        NotificationStatus.QUEUED,
      );

      TestAssertions.assertNotificationResponse(result, {
        id: notificationId,
      });
    });

    it('should throw NotFoundException when notification not found', async () => {
      // Arrange
      const notificationId = 'non-existent-id';
      mockDataAccess.findById.mockResolvedValue(null);

      // Act & Assert
      await TestAssertions.assertThrowsError(
        () => service.retry(notificationId),
        NotFoundException,
        'Notification not found',
      );
    });

    it('should throw BadRequestException when retry is not allowed', async () => {
      // Arrange
      const notificationId = 'test-id';
      const notification = TestDataBuilder.createNotification({
        id: notificationId,
        status: NotificationStatus.FAILED,
        retryCount: 3,
      });

      notification.canRetry = vi.fn().mockReturnValue(false);
      mockDataAccess.findById.mockResolvedValue(notification);

      // Act & Assert
      await TestAssertions.assertThrowsError(
        () => service.retry(notificationId),
        BadRequestException,
        'Notification cannot be retried',
      );
    });
  });

  describe('getStats', () => {
    it('should return notification statistics', async () => {
      // Arrange
      const statusCounts = {
        [NotificationStatus.CREATED]: 5,
        [NotificationStatus.QUEUED]: 10,
        [NotificationStatus.PROCESSING]: 1,
        [NotificationStatus.SENT]: 25,
        [NotificationStatus.DELIVERED]: 20,
        [NotificationStatus.FAILED]: 3,
        [NotificationStatus.CANCELLED]: 2,
      };

      const recentFailures = TestDataBuilder.createNotifications(
        2,
        (index) => ({
          status: NotificationStatus.FAILED,
          lastError: `Error ${index}`,
          updatedAt: TestDateUtils.pastDate(30 - index * 10),
        }),
      );

      mockDataAccess.getStats.mockResolvedValue(
        statusCounts,
      );
      mockNotificationRepository.getRecentFailures.mockResolvedValue(
        recentFailures,
      );

      // Act
      const result = await service.getStats();

      // Assert
      expect(mockDataAccess.getStats).toHaveBeenCalled();
      expect(mockNotificationRepository.getRecentFailures).toHaveBeenCalledWith(
        mockConfig.recentFailuresWindowMinutes,
        mockConfig.maxRecentFailuresDisplay,
      );

      expect(result).toEqual({
        statusCounts,
        recentFailureCount: 2,
        recentFailures: recentFailures.map((n) => ({
          id: n.id,
          channel: n.channel,
          error: n.lastError,
          failedAt: n.updatedAt,
        })),
      });
    });
  });
});
