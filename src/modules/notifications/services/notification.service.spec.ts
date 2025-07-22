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
  let mockNotificationRepository: jest.Mocked<NotificationRepository>;
  let mockNotificationProducer: jest.Mocked<NotificationProducer>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockDataSource: jest.Mocked<DataSource>;
  let mockEntityManager: jest.Mocked<EntityManager>;
  let mockRepository: jest.Mocked<Repository<Notification>>;
  let mockValidatorService: jest.Mocked<NotificationValidatorService>;
  let mockOrchestrationService: jest.Mocked<NotificationOrchestrationService>;

  const mockConfig = {
    maxRetries: 3,
    defaultPageSize: 20,
    maxPageSize: 100,
    recentFailuresWindowMinutes: 60,
    pendingNotificationsBatchSize: 100,
    maxRecentFailuresDisplay: 10,
  };

  beforeEach(async () => {
    // Create mocks
    mockNotificationRepository = {
      findById: jest.fn(),
      findAll: jest.fn(),
      updateStatus: jest.fn(),
      update: jest.fn(),
      getStatusCounts: jest.fn(),
      getRecentFailures: jest.fn(),
    } as any;

    mockNotificationProducer = {
      addNotificationJob: jest.fn(),
      removeNotificationJob: jest.fn(),
    } as any;

    mockConfigService = {
      get: jest.fn().mockReturnValue(mockConfig),
    } as any;

    mockValidatorService = {
      validate: jest.fn(),
      validateWithCategories: jest.fn(),
    } as any;

    mockOrchestrationService = {
      createNotification: jest.fn(),
      updateNotification: jest.fn(),
      cancelNotification: jest.fn(),
      retryNotification: jest.fn(),
    } as any;

    mockRepository = MockFactory.createMockRepository<Notification>();
    mockEntityManager = {
      getRepository: jest.fn().mockReturnValue(mockRepository),
    } as any;

    mockDataSource = {
      transaction: jest
        .fn()
        .mockImplementation(
          (callback: (manager: EntityManager) => Promise<unknown>) =>
            callback(mockEntityManager),
        ),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: NotificationRepository,
          useValue: mockNotificationRepository,
        },
        {
          provide: NotificationProducer,
          useValue: mockNotificationProducer,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: NotificationValidatorService,
          useValue: mockValidatorService,
        },
        {
          provide: NotificationOrchestrationService,
          useValue: mockOrchestrationService,
        },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
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
      mockValidatorService.validateWithCategories.mockResolvedValue({
        isValid: true,
        criticalErrors: [],
        warningErrors: [],
        allErrors: [],
      });

      // Mock orchestration service to return created notification
      mockOrchestrationService.createNotification.mockResolvedValue(
        savedNotification,
      );

      // Act
      const result = await service.create(createDto);

      // Assert - Orchestration service should be called with prepared data
      expect(mockOrchestrationService.createNotification).toHaveBeenCalledWith(
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

      mockValidatorService.validateWithCategories.mockResolvedValue({
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

      mockValidatorService.validateWithCategories.mockResolvedValue({
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

      mockValidatorService.validateWithCategories.mockResolvedValue({
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
      mockNotificationRepository.findById.mockResolvedValue(notification);

      // Act
      const result = await service.findOne(notificationId);

      // Assert
      expect(mockNotificationRepository.findById).toHaveBeenCalledWith(
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
      mockNotificationRepository.findById.mockResolvedValue(null);

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

      mockNotificationRepository.findAll.mockResolvedValue({
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
      expect(mockNotificationRepository.findAll).toHaveBeenCalledWith(
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

      mockNotificationRepository.findAll.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 100, // Should be capped at maxPageSize
        totalPages: 0,
      });

      // Act
      await service.findAll(filters);

      // Assert
      expect(mockNotificationRepository.findAll).toHaveBeenCalledWith(
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

      mockNotificationRepository.findAll.mockResolvedValue({
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
      expect(mockNotificationRepository.findAll).toHaveBeenCalledWith(
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

      mockNotificationRepository.findById.mockResolvedValue(
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
      mockNotificationRepository.findById.mockResolvedValue(null);

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

      mockNotificationRepository.findById.mockResolvedValue(sentNotification);

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

      mockNotificationRepository.findById.mockResolvedValue(
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

      mockNotificationRepository.findById.mockResolvedValue(
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
      notification.markAsCancelled = jest.fn().mockImplementation(() => {
        notification.status = NotificationStatus.CANCELLED;
      });

      mockNotificationRepository.findById.mockResolvedValue(notification);
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
      mockNotificationRepository.findById.mockResolvedValue(null);

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

      notification.markAsCancelled = jest.fn().mockImplementation(() => {
        throw new Error('Cannot cancel sent notification');
      });

      mockNotificationRepository.findById.mockResolvedValue(notification);

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

      failedNotification.canRetry = jest.fn().mockReturnValue(true);

      mockNotificationRepository.findById.mockResolvedValue(failedNotification);
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
      mockNotificationRepository.findById.mockResolvedValue(null);

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

      notification.canRetry = jest.fn().mockReturnValue(false);
      mockNotificationRepository.findById.mockResolvedValue(notification);

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

      mockNotificationRepository.getStatusCounts.mockResolvedValue(
        statusCounts,
      );
      mockNotificationRepository.getRecentFailures.mockResolvedValue(
        recentFailures,
      );

      // Act
      const result = await service.getStats();

      // Assert
      expect(mockNotificationRepository.getStatusCounts).toHaveBeenCalled();
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
