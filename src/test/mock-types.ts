/**
 * Mock types and interfaces for testing
 * Eliminates 'any' types in test mocks and provides better type safety
 */

import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';

/**
 * Mock logger interface with all Logger methods properly typed
 */
export interface MockLogger extends Partial<Logger> {
  log: jest.Mock<void, [message: string, context?: string]>;
  error: jest.Mock<void, [message: string, trace?: string, context?: string]>;
  warn: jest.Mock<void, [message: string, context?: string]>;
  debug: jest.Mock<void, [message: string, context?: string]>;
  verbose: jest.Mock<void, [message: string, context?: string]>;
}

/**
 * Redis client mock interface
 */
export interface MockRedisClient {
  pipeline: jest.Mock<MockRedisPipeline, []>;
  get: jest.Mock<Promise<string | null>, [key: string]>;
  set: jest.Mock<Promise<string>, [key: string, value: string, ...args: any[]]>;
  del: jest.Mock<Promise<number>, [key: string]>;
  exists: jest.Mock<Promise<number>, [key: string]>;
  hgetall: jest.Mock<Promise<Record<string, string>>, [key: string]>;
  hset: jest.Mock<Promise<number>, [key: string, ...args: any[]]>;
  hincrby: jest.Mock<
    Promise<number>,
    [key: string, field: string, increment: number]
  >;
  expire: jest.Mock<Promise<number>, [key: string, seconds: number]>;
  llen: jest.Mock<Promise<number>, [key: string]>;
  lrange: jest.Mock<
    Promise<string[]>,
    [key: string, start: number, end: number]
  >;
  lpush: jest.Mock<Promise<number>, [key: string, ...values: string[]]>;
  ltrim: jest.Mock<Promise<string>, [key: string, start: number, end: number]>;
  keys: jest.Mock<Promise<string[]>, [pattern: string]>;
}

/**
 * Redis pipeline mock interface
 */
export interface MockRedisPipeline {
  hincrby: jest.Mock<
    MockRedisPipeline,
    [key: string, field: string, increment: number]
  >;
  expire: jest.Mock<MockRedisPipeline, [key: string, seconds: number]>;
  lpush: jest.Mock<MockRedisPipeline, [key: string, ...values: string[]]>;
  ltrim: jest.Mock<
    MockRedisPipeline,
    [key: string, start: number, end: number]
  >;
  exec: jest.Mock<Promise<any[]>, []>;
}

/**
 * Mock Redis provider interface
 */
export interface MockRedisProvider {
  getClient: jest.Mock<MockRedisClient, []>;
  ping: jest.Mock<Promise<string>, []>;
}

/**
 * Mock repository interface for TypeORM repositories
 */
export interface MockRepository<T = any> {
  find: jest.Mock<Promise<T[]>, [options?: any]>;
  findOne: jest.Mock<Promise<T | null>, [options?: any]>;
  findOneBy: jest.Mock<Promise<T | null>, [options?: any]>;
  findOneOrFail: jest.Mock<Promise<T>, [options?: any]>;
  save: jest.Mock<Promise<T>, [entity: Partial<T>]>;
  create: jest.Mock<T, [entityLike?: Partial<T>]>;
  update: jest.Mock<Promise<any>, [criteria: any, partialEntity: Partial<T>]>;
  delete: jest.Mock<Promise<any>, [criteria: any]>;
  remove: jest.Mock<Promise<T>, [entity: T]>;
  count: jest.Mock<Promise<number>, [options?: any]>;
  findAndCount: jest.Mock<Promise<[T[], number]>, [options?: any]>;
}

/**
 * Mock notification service interface
 */
export interface MockNotificationService {
  create: jest.Mock<Promise<any>, [dto: any]>;
  findAll: jest.Mock<Promise<any>, [filters: any]>;
  findOne: jest.Mock<Promise<any>, [id: string]>;
  update: jest.Mock<Promise<any>, [id: string, dto: any]>;
  cancel: jest.Mock<Promise<any>, [id: string]>;
  retry: jest.Mock<Promise<any>, [id: string]>;
  getStats: jest.Mock<Promise<any>, []>;
}

/**
 * Mock notification producer interface
 */
export interface MockNotificationProducer {
  addNotificationJob: jest.Mock<
    Promise<void>,
    [id: string, priority?: any, scheduledFor?: Date, metadata?: any]
  >;
  removeNotificationJob: jest.Mock<Promise<boolean>, [id: string]>;
  getJobStatus: jest.Mock<Promise<any>, [id: string]>;
  getQueueHealth: jest.Mock<Promise<any>, []>;
}

/**
 * Mock Bull queue interface
 */
export interface MockBullQueue {
  add: jest.Mock<Promise<any>, [name: string, data: any, options?: any]>;
  getJob: jest.Mock<Promise<any>, [jobId: string]>;
  removeJobs: jest.Mock<Promise<void>, [pattern: string]>;
  getJobs: jest.Mock<
    Promise<any[]>,
    [types: string[], start?: number, end?: number]
  >;
  getJobCounts: jest.Mock<Promise<any>, []>;
  clean: jest.Mock<Promise<any[]>, [grace: number, type: string]>;
  pause: jest.Mock<Promise<void>, []>;
  resume: jest.Mock<Promise<void>, []>;
  isPaused: jest.Mock<Promise<boolean>, []>;
}

/**
 * Mock config service interface
 */
export interface MockConfigService {
  get: jest.Mock<any, [key: string, defaultValue?: any]>;
}

/**
 * Factory functions to create properly typed mocks
 */
export class MockFactory {
  /**
   * Creates a properly typed logger mock
   */
  static createMockLogger(): MockLogger {
    return {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };
  }

  /**
   * Creates a properly typed Redis client mock
   */
  static createMockRedisClient(): MockRedisClient {
    const mockPipeline: MockRedisPipeline = {
      hincrby: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      lpush: jest.fn().mockReturnThis(),
      ltrim: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };

    return {
      pipeline: jest.fn().mockReturnValue(mockPipeline),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      hgetall: jest.fn(),
      hset: jest.fn(),
      hincrby: jest.fn(),
      expire: jest.fn(),
      llen: jest.fn(),
      lrange: jest.fn(),
      lpush: jest.fn(),
      ltrim: jest.fn(),
      keys: jest.fn(),
    };
  }

  /**
   * Creates a properly typed Redis provider mock
   */
  static createMockRedisProvider(): MockRedisProvider {
    return {
      getClient: jest.fn().mockReturnValue(MockFactory.createMockRedisClient()),
      ping: jest.fn().mockResolvedValue('PONG'),
    };
  }

  /**
   * Creates a properly typed repository mock
   */
  static createMockRepository<T = any>(): MockRepository<T> {
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
      findAndCount: jest.fn(),
    };
  }

  /**
   * Creates a properly typed config service mock
   */
  static createMockConfigService(): MockConfigService {
    return {
      get: jest.fn(),
    };
  }
}

/**
 * Type-safe assertion helpers
 */
export class TypeSafeAssertions {
  /**
   * Assert that a mock was called with specific typed arguments
   */
  static assertMockCalledWith<T extends (...args: any[]) => any>(
    mockFn: jest.MockedFunction<T>,
    ...expectedArgs: Parameters<T>
  ): void {
    expect(mockFn).toHaveBeenCalledWith(...expectedArgs);
  }

  /**
   * Assert that a mock was called a specific number of times
   */
  static assertMockCalledTimes<T extends (...args: any[]) => any>(
    mockFn: jest.MockedFunction<T>,
    times: number,
  ): void {
    expect(mockFn).toHaveBeenCalledTimes(times);
  }
}
