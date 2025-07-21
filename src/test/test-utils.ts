import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, ObjectLiteral } from 'typeorm';
import { Notification } from '../modules/notifications/entities/notification.entity';
import { NotificationChannel } from '../modules/notifications/enums/notification-channel.enum';
import { NotificationStatus } from '../modules/notifications/enums/notification-status.enum';
import { NotificationPriority } from '../modules/notifications/enums/notification-priority.enum';
import { CreateNotificationDto } from '../modules/notifications/dto/create-notification.dto';
import { NotificationResponseDto } from '../modules/notifications/dto/notification-response.dto';
import { PaginatedResponseDto } from '../modules/notifications/dto/paginated-response.dto';
import { randomUUID } from 'crypto';

/**
 * Test data builder for creating notification entities and DTOs
 */
export class TestDataBuilder {
  /**
   * Creates a valid notification entity with default or override values
   */
  static createNotification(
    overrides: Partial<Notification> = {},
  ): Notification {
    const entity = new Notification();
    entity.id = overrides.id || randomUUID();
    entity.channel = overrides.channel || NotificationChannel.EMAIL;
    entity.recipient = overrides.recipient || 'test@example.com';
    entity.subject = overrides.subject || 'Test Subject';
    entity.content = overrides.content || 'Test notification content';
    entity.status = overrides.status || NotificationStatus.CREATED;
    entity.scheduledFor = overrides.scheduledFor || null;
    entity.createdAt = overrides.createdAt || new Date();
    entity.updatedAt = overrides.updatedAt || new Date();
    entity.deliveredAt = overrides.deliveredAt || null;
    entity.retryCount = overrides.retryCount || 0;
    entity.lastError = overrides.lastError || null;
    entity.sentAt = overrides.sentAt || null;
    entity.metadata = overrides.metadata || {};

    return entity;
  }

  /**
   * Creates a valid CreateNotificationDto
   */
  static createNotificationDto(
    overrides: Partial<CreateNotificationDto> = {},
  ): CreateNotificationDto {
    const dto = new CreateNotificationDto();
    dto.channel = overrides.channel || NotificationChannel.EMAIL;
    dto.recipient = overrides.recipient || 'test@example.com';
    dto.subject = overrides.subject || 'Test Subject';
    dto.content = overrides.content || 'Test notification content';
    dto.scheduledFor = overrides.scheduledFor;
    dto.metadata = overrides.metadata || {};

    return dto;
  }

  /**
   * Creates a NotificationResponseDto from entity or with overrides
   */
  static createNotificationResponse(
    entity?: Notification,
    overrides: Partial<NotificationResponseDto> = {},
  ): NotificationResponseDto {
    const baseEntity = entity || this.createNotification();

    return {
      id: overrides.id || baseEntity.id,
      channel: overrides.channel || baseEntity.channel,
      recipient: overrides.recipient || baseEntity.recipient,
      subject: overrides.subject || baseEntity.subject,
      content: overrides.content || baseEntity.content,
      status: overrides.status || baseEntity.status,
      scheduledFor: overrides.scheduledFor || baseEntity.scheduledFor,
      createdAt: overrides.createdAt || baseEntity.createdAt,
      updatedAt: overrides.updatedAt || baseEntity.updatedAt,
      deliveredAt: overrides.deliveredAt || baseEntity.deliveredAt,
      retryCount: overrides.retryCount || baseEntity.retryCount,
      lastError: overrides.lastError || baseEntity.lastError,
      sentAt: overrides.sentAt || baseEntity.sentAt,
      metadata: overrides.metadata || baseEntity.metadata,
    };
  }

  /**
   * Creates a paginated response with test data
   */
  static createPaginatedResponse<T>(
    data: T[],
    overrides: Partial<PaginatedResponseDto<T>> = {},
  ): PaginatedResponseDto<T> {
    const total = overrides.total || data.length;
    const page = overrides.page || 1;
    const limit = overrides.limit || 20;
    const totalPages = Math.ceil(total / limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    };
  }

  /**
   * Creates multiple notification entities
   */
  static createNotifications(
    count: number,
    overrideFactory?: (index: number) => Partial<Notification>,
  ): Notification[] {
    return Array.from({ length: count }, (_, index) => {
      const overrides = overrideFactory ? overrideFactory(index) : {};
      return this.createNotification({
        recipient: `test${index}@example.com`,
        subject: `Test Subject ${index}`,
        ...overrides,
      });
    });
  }

  /**
   * Creates notification with specific status
   */
  static createNotificationWithStatus(
    status: NotificationStatus,
    overrides: Partial<Notification> = {},
  ): Notification {
    const baseOverrides: Partial<Notification> = { status };

    // Set appropriate timestamps based on status
    switch (status) {
      case NotificationStatus.SENT:
        baseOverrides.deliveredAt = new Date();
        break;
      case NotificationStatus.FAILED:
        baseOverrides.lastError = 'Test error message';
        break;
      case NotificationStatus.DELIVERED:
        baseOverrides.deliveredAt = new Date();
        break;
    }

    return this.createNotification({ ...baseOverrides, ...overrides });
  }
}

/**
 * Mock factory for creating Jest mocks of common services
 */
export class MockFactory {
  /**
   * Creates a mock repository with common methods
   */
  static createMockRepository<T extends ObjectLiteral = any>(): jest.Mocked<
    Repository<T>
  > {
    return {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      findOneOrFail: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      remove: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
      manager: {
        transaction: jest.fn(),
      } as any,
      metadata: {} as any,
      target: {} as any,
      query: jest.fn(),
      clear: jest.fn(),
      increment: jest.fn(),
      decrement: jest.fn(),
      findAndCount: jest.fn(),
      findByIds: jest.fn(),
      findOneById: jest.fn(),
      getId: jest.fn(),
      hasId: jest.fn(),
      merge: jest.fn(),
      preload: jest.fn(),
      recover: jest.fn(),
      restore: jest.fn(),
      softDelete: jest.fn(),
      softRemove: jest.fn(),
      upsert: jest.fn(),
    } as unknown as jest.Mocked<Repository<T>>;
  }

  /**
   * Creates a mock notification service
   */
  static createMockNotificationService() {
    return {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      cancel: jest.fn(),
      retry: jest.fn(),
      getStats: jest.fn(),
    };
  }

  /**
   * Creates a mock notification producer service
   */
  static createMockNotificationProducer() {
    return {
      addNotificationJob: jest.fn(),
      removeJob: jest.fn(),
      getJobStatus: jest.fn(),
      getQueueHealth: jest.fn(),
    };
  }

  /**
   * Creates a mock queue service
   */
  static createMockQueueService() {
    return {
      add: jest.fn(),
      getJob: jest.fn(),
      removeJobs: jest.fn(),
      getJobs: jest.fn(),
      getJobCounts: jest.fn(),
      clean: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      isPaused: jest.fn(),
    };
  }

  /**
   * Creates a mock channel router service
   */
  static createMockChannelRouter() {
    return {
      routeNotification: jest.fn(),
      getAvailableChannels: jest.fn(),
      isChannelAvailable: jest.fn(),
    };
  }

  /**
   * Creates a mock logger
   */
  static createMockLogger() {
    return {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };
  }
}

/**
 * Base test class with common setup and utilities
 */
export abstract class BaseTestClass {
  protected module: TestingModule;

  /**
   * Creates a testing module with the provided configuration
   */
  protected async createTestingModule(
    moduleConfig: any,
  ): Promise<TestingModule> {
    this.module = await Test.createTestingModule(moduleConfig).compile();
    return this.module;
  }

  /**
   * Gets a service from the testing module
   */
  protected getService<T>(token: any): T {
    return this.module.get<T>(token);
  }

  /**
   * Gets a mock repository
   */
  protected getMockRepository<T extends ObjectLiteral>(
    entity: any,
  ): jest.Mocked<Repository<T>> {
    return this.module.get(getRepositoryToken(entity));
  }

  /**
   * Cleanup after tests
   */
  async cleanup(): Promise<void> {
    if (this.module) {
      await this.module.close();
    }
  }
}

/**
 * Test assertion helpers
 */
export class TestAssertions {
  /**
   * Asserts that an entity matches the expected DTO structure
   */
  static assertNotificationResponse(
    actual: NotificationResponseDto,
    expected: Partial<NotificationResponseDto>,
  ): void {
    expect(actual).toMatchObject(expected);
    expect(actual.id).toBeDefined();
    expect(actual.createdAt).toBeDefined();
    expect(actual.updatedAt).toBeDefined();
  }

  /**
   * Asserts that a paginated response has the correct structure
   */
  static assertPaginatedResponse<T>(
    actual: PaginatedResponseDto<T>,
    expectedData: T[],
    expectedTotal: number,
    expectedPage: number = 1,
    expectedLimit: number = 20,
  ): void {
    expect(actual.data).toEqual(expectedData);
    expect(actual.total).toBe(expectedTotal);
    expect(actual.page).toBe(expectedPage);
    expect(actual.limit).toBe(expectedLimit);
    expect(actual.totalPages).toBe(Math.ceil(expectedTotal / expectedLimit));
    expect(actual.hasNext).toBe(expectedPage < actual.totalPages);
    expect(actual.hasPrevious).toBe(expectedPage > 1);
  }

  /**
   * Asserts that a service method was called with the correct parameters
   */
  static assertServiceMethodCalled(
    mockMethod: jest.Mock,
    expectedParams: any[],
    callIndex: number = 0,
  ): void {
    expect(mockMethod).toHaveBeenCalledWith(...expectedParams);
    if (callIndex > 0) {
      expect(mockMethod).toHaveBeenNthCalledWith(
        callIndex + 1,
        ...expectedParams,
      );
    }
  }

  /**
   * Asserts that an error is thrown with the expected message
   */
  static async assertThrowsError(
    asyncFunction: () => Promise<any>,
    expectedErrorClass: any,
    expectedMessage?: string,
  ): Promise<void> {
    await expect(asyncFunction()).rejects.toThrow(expectedErrorClass);
    if (expectedMessage) {
      await expect(asyncFunction()).rejects.toThrow(expectedMessage);
    }
  }
}

/**
 * Date utilities for testing
 */
export class TestDateUtils {
  /**
   * Creates a date in the past
   */
  static pastDate(minutesAgo: number = 60): Date {
    return new Date(Date.now() - minutesAgo * 60 * 1000);
  }

  /**
   * Creates a date in the future
   */
  static futureDate(minutesFromNow: number = 60): Date {
    return new Date(Date.now() + minutesFromNow * 60 * 1000);
  }

  /**
   * Creates a date string in ISO format
   */
  static isoDateString(date: Date = new Date()): string {
    return date.toISOString();
  }

  /**
   * Checks if two dates are approximately equal (within tolerance)
   */
  static areDatesApproximatelyEqual(
    date1: Date,
    date2: Date,
    toleranceMs: number = 1000,
  ): boolean {
    return Math.abs(date1.getTime() - date2.getTime()) <= toleranceMs;
  }
}

/**
 * Environment utilities for testing
 */
export class TestEnvironment {
  /**
   * Sets environment variables for testing
   */
  static setTestEnvironment(): void {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL =
      'postgres://test:test@localhost:5433/notifyhub_test';
    process.env.REDIS_HOST = 'localhost';
    process.env.REDIS_PORT = '6380';
    process.env.JWT_SECRET = 'test-secret';
    process.env.API_BASE_URL = 'http://localhost:3000';
  }

  /**
   * Restores original environment variables
   */
  static restoreEnvironment(originalEnv: NodeJS.ProcessEnv): void {
    process.env = originalEnv;
  }

  /**
   * Gets a copy of current environment variables
   */
  static getCurrentEnvironment(): NodeJS.ProcessEnv {
    return { ...process.env };
  }
}
