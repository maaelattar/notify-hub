/**
 * Mock types and interfaces for testing
 * Eliminates 'any' types in test mocks and provides better type safety
 */

import { Logger } from '@nestjs/common';
import { MockedFunction, vi } from 'vitest';

/**
 * Mock logger interface with all Logger methods properly typed
 */
export interface MockLogger extends Partial<Logger> {
  log: MockedFunction<(message: string, context?: string) => void>;
  error: MockedFunction<(message: string, trace?: string, context?: string) => void>;
  warn: MockedFunction<(message: string, context?: string) => void>;
  debug: MockedFunction<(message: string, context?: string) => void>;
  verbose: MockedFunction<(message: string, context?: string) => void>;
}

/**
 * Redis client mock interface
 */
export interface MockRedisClient {
  pipeline: MockedFunction<() => MockRedisPipeline>;
  get: MockedFunction<(key: string) => Promise<string | null>>;
  set: MockedFunction<(key: string, value: string, ...args: any[]) => Promise<string>>;
  del: MockedFunction<(key: string) => Promise<number>>;
  exists: MockedFunction<(key: string) => Promise<number>>;
  hgetall: MockedFunction<(key: string) => Promise<Record<string, string>>>;
  hset: MockedFunction<(key: string, ...args: any[]) => Promise<number>>;
  hincrby: MockedFunction<(
    key: string,
    field: string,
    increment: number
  ) => Promise<number>>;
  expire: MockedFunction<(key: string, seconds: number) => Promise<number>>;
  llen: MockedFunction<(key: string) => Promise<number>>;
  lrange: MockedFunction<(
    key: string,
    start: number,
    end: number
  ) => Promise<string[]>>;
  lpush: MockedFunction<(key: string, ...values: string[]) => Promise<number>>;
  ltrim: MockedFunction<(key: string, start: number, end: number) => Promise<string>>;
  keys: MockedFunction<(pattern: string) => Promise<string[]>>;
}

/**
 * Redis pipeline mock interface
 */
export interface MockRedisPipeline {
  hincrby: MockedFunction<(
    key: string,
    field: string,
    increment: number
  ) => MockRedisPipeline>;
  expire: MockedFunction<(key: string, seconds: number) => MockRedisPipeline>;
  lpush: MockedFunction<(key: string, ...values: string[]) => MockRedisPipeline>;
  ltrim: MockedFunction<(
    key: string,
    start: number,
    end: number
  ) => MockRedisPipeline>;
  hgetall: MockedFunction<(key: string) => MockRedisPipeline>;
  lrange: MockedFunction<(key: string, start: number, end: number) => MockRedisPipeline>;
  exec: MockedFunction<() => Promise<any[]>>;
}

/**
 * Mock Redis provider interface
 */
export interface MockRedisProvider {
  getClient: MockedFunction<() => MockRedisClient>;
  ping: MockedFunction<() => Promise<string>>;
}

/**
 * Mock repository interface for TypeORM repositories
 */
export interface MockRepository<T = any> {
  find: MockedFunction<(options?: any) => Promise<T[]>>;
  findOne: MockedFunction<(options?: any) => Promise<T | null>>;
  findOneBy: MockedFunction<(options?: any) => Promise<T | null>>;
  findOneOrFail: MockedFunction<(options?: any) => Promise<T>>;
  save: MockedFunction<(entity: Partial<T>) => Promise<T>>;
  create: MockedFunction<(entityLike?: Partial<T>) => T>;
  update: MockedFunction<(criteria: any, partialEntity: Partial<T>) => Promise<any>>;
  delete: MockedFunction<(criteria: any) => Promise<any>>;
  remove: MockedFunction<(entity: T) => Promise<T>>;
  count: MockedFunction<(options?: any) => Promise<number>>;
  findAndCount: MockedFunction<(options?: any) => Promise<[T[], number]>>;
}

/**
 * Mock notification service interface
 */
export interface MockNotificationService {
  create: MockedFunction<(dto: any) => Promise<any>>;
  findAll: MockedFunction<(filters: any) => Promise<any>>;
  findOne: MockedFunction<(id: string) => Promise<any>>;
  update: MockedFunction<(id: string, dto: any) => Promise<any>>;
  cancel: MockedFunction<(id: string) => Promise<any>>;
  retry: MockedFunction<(id: string) => Promise<any>>;
  getStats: MockedFunction<() => Promise<any>>;
}

/**
 * Mock notification producer interface
 */
export interface MockNotificationProducer {
  addNotificationJob: MockedFunction<(
    id: string,
    priority?: any,
    scheduledFor?: Date,
    metadata?: any
  ) => Promise<void>>;
  removeNotificationJob: MockedFunction<(id: string) => Promise<boolean>>;
  getJobStatus: MockedFunction<(id: string) => Promise<any>>;
  getQueueHealth: MockedFunction<() => Promise<any>>;
}

/**
 * Mock Bull queue interface
 */
export interface MockBullQueue {
  add: MockedFunction<(name: string, data: any, options?: any) => Promise<any>>;
  getJob: MockedFunction<(jobId: string) => Promise<any>>;
  removeJobs: MockedFunction<(pattern: string) => Promise<void>>;
  getJobs: MockedFunction<(
    types: string[],
    start?: number,
    end?: number
  ) => Promise<any[]>>;
  getJobCounts: MockedFunction<() => Promise<any>>;
  clean: MockedFunction<(grace: number, type: string) => Promise<any[]>>;
  pause: MockedFunction<() => Promise<void>>;
  resume: MockedFunction<() => Promise<void>>;
  isPaused: MockedFunction<() => Promise<boolean>>;
}

/**
 * Mock config service interface
 */
export interface MockConfigService {
  get: MockedFunction<(key: string, defaultValue?: any) => any>;
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
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn(),
    };
  }

  /**
   * Creates a properly typed Redis client mock
   */
  static createMockRedisClient(): MockRedisClient {
    const mockPipeline: MockRedisPipeline = {
      hincrby: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      lpush: vi.fn().mockReturnThis(),
      ltrim: vi.fn().mockReturnThis(),
      hgetall: vi.fn().mockReturnThis(),
      lrange: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };

    return {
      pipeline: vi.fn().mockReturnValue(mockPipeline),
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      exists: vi.fn(),
      hgetall: vi.fn(),
      hset: vi.fn(),
      hincrby: vi.fn(),
      expire: vi.fn(),
      llen: vi.fn(),
      lrange: vi.fn(),
      lpush: vi.fn(),
      ltrim: vi.fn(),
      keys: vi.fn(),
    };
  }

  /**
   * Creates a properly typed Redis provider mock
   */
  static createMockRedisProvider(): MockRedisProvider {
    return {
      getClient: vi.fn().mockReturnValue(MockFactory.createMockRedisClient()),
      ping: vi.fn().mockResolvedValue('PONG'),
    };
  }

  /**
   * Creates a properly typed repository mock
   */
  static createMockRepository<T = any>(): MockRepository<T> {
    return {
      find: vi.fn(),
      findOne: vi.fn(),
      findOneBy: vi.fn(),
      findOneOrFail: vi.fn(),
      save: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      remove: vi.fn(),
      count: vi.fn(),
      findAndCount: vi.fn(),
    };
  }

  /**
   * Creates a properly typed config service mock
   */
  static createMockConfigService(): MockConfigService {
    return {
      get: vi.fn(),
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
    mockFn: MockedFunction<T>,
    ...expectedArgs: Parameters<T>
  ): void {
    expect(mockFn).toHaveBeenCalledWith(...expectedArgs);
  }

  /**
   * Assert that a mock was called a specific number of times
   */
  static assertMockCalledTimes<T extends (...args: any[]) => any>(
    mockFn: MockedFunction<T>,
    times: number,
  ): void {
    expect(mockFn).toHaveBeenCalledTimes(times);
  }
}
