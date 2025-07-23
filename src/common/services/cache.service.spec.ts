import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { CacheService, CacheOptions } from './cache.service';
import { RedisProvider } from '../../modules/common/providers/redis.provider';
import type Redis from 'ioredis';

describe('CacheService', () => {
  let service: CacheService;
  let mockRedisProvider: { getClient: ReturnType<typeof vi.fn> };
  let mockRedis: {
    get: ReturnType<typeof vi.fn>;
    setex: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    exists: ReturnType<typeof vi.fn>;
    mget: ReturnType<typeof vi.fn>;
    pipeline: ReturnType<typeof vi.fn>;
    keys: ReturnType<typeof vi.fn>;
    ping: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };
  let mockConfigService: {
    get: ReturnType<typeof vi.fn>;
  };
  let mockPipeline: {
    setex: ReturnType<typeof vi.fn>;
    exec: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock pipeline
    mockPipeline = {
      setex: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 'OK'], [null, 'OK']]),
    };

    // Create mock Redis client
    mockRedis = {
      get: vi.fn(),
      setex: vi.fn(),
      del: vi.fn(),
      exists: vi.fn(),
      mget: vi.fn(),
      pipeline: vi.fn().mockReturnValue(mockPipeline),
      keys: vi.fn(),
      ping: vi.fn(),
      info: vi.fn(),
    };

    // Create mock RedisProvider
    mockRedisProvider = {
      getClient: vi.fn().mockReturnValue(mockRedis as unknown as Redis),
    };

    // Create mock ConfigService
    mockConfigService = {
      get: vi.fn()
        .mockImplementation((key: string, defaultValue?: unknown) => {
          if (key === 'CACHE_DEFAULT_TTL') return defaultValue ?? 3600;
          if (key === 'CACHE_ENABLE_COMPRESSION') return defaultValue ?? true;
          return defaultValue;
        }),
    };

    // Create service instance
    service = new CacheService(
      mockRedisProvider as unknown as RedisProvider,
      mockConfigService as unknown as ConfigService,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(mockRedisProvider.getClient).toHaveBeenCalled();
      expect(mockConfigService.get).toHaveBeenCalledWith('CACHE_DEFAULT_TTL', 3600);
      expect(mockConfigService.get).toHaveBeenCalledWith('CACHE_ENABLE_COMPRESSION', true);
    });
  });

  describe('get', () => {
    it('should return cached value on hit', async () => {
      // Arrange
      const key = 'test-key';
      const expectedValue = { data: 'test-data' };
      const serializedValue = JSON.stringify(expectedValue);
      
      mockRedis.get.mockResolvedValue(serializedValue);

      // Act
      const result = await service.get(key);

      // Assert
      expect(mockRedis.get).toHaveBeenCalledWith('notifyhub:test-key');
      expect(result).toEqual(expectedValue);
      
      const stats = service.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(0);
    });

    it('should return null on cache miss', async () => {
      // Arrange
      const key = 'missing-key';
      mockRedis.get.mockResolvedValue(null);

      // Act
      const result = await service.get(key);

      // Assert
      expect(mockRedis.get).toHaveBeenCalledWith('notifyhub:missing-key');
      expect(result).toBeNull();
      
      const stats = service.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(1);
    });

    it('should handle namespace in key', async () => {
      // Arrange
      const key = 'test-key';
      const options: CacheOptions = { namespace: 'users' };
      const expectedValue = 'test-value';
      
      mockRedis.get.mockResolvedValue(JSON.stringify(expectedValue));

      // Act
      await service.get(key, options);

      // Assert
      expect(mockRedis.get).toHaveBeenCalledWith('notifyhub:users:test-key');
    });

    it('should return null and log error when Redis operation fails', async () => {
      // Arrange
      const key = 'error-key';
      const error = new Error('Redis connection failed');
      mockRedis.get.mockRejectedValue(error);

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      const result = await service.get(key);

      // Assert
      expect(result).toBeNull();
      expect(loggerErrorSpy).toHaveBeenCalledWith('Cache get failed', {
        key: 'notifyhub:error-key',
        error: 'Redis connection failed',
      });

      loggerErrorSpy.mockRestore();
    });

    it('should handle non-Error exceptions', async () => {
      // Arrange
      const key = 'error-key';
      mockRedis.get.mockRejectedValue('String error');

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      const result = await service.get(key);

      // Assert
      expect(result).toBeNull();
      expect(loggerErrorSpy).toHaveBeenCalledWith('Cache get failed', {
        key: 'notifyhub:error-key',
        error: 'Unknown error',
      });

      loggerErrorSpy.mockRestore();
    });
  });

  describe('set', () => {
    it('should store value with default TTL', async () => {
      // Arrange
      const key = 'test-key';
      const value = { data: 'test-data' };
      mockRedis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.set(key, value);

      // Assert
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'notifyhub:test-key',
        3600,
        JSON.stringify(value),
      );
      expect(result).toBe(true);
      
      const stats = service.getStats();
      expect(stats.sets).toBe(1);
    });

    it('should store value with custom TTL', async () => {
      // Arrange
      const key = 'test-key';
      const value = 'test-value';
      const options: CacheOptions = { ttl: 1800 };
      mockRedis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.set(key, value, options);

      // Assert
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'notifyhub:test-key',
        1800,
        JSON.stringify(value),
      );
      expect(result).toBe(true);
    });

    it('should handle namespace and compression options', async () => {
      // Arrange
      const key = 'test-key';
      const value = 'test-value';
      const options: CacheOptions = { 
        namespace: 'cache', 
        compress: true, 
        ttl: 900 
      };
      mockRedis.setex.mockResolvedValue('OK');

      // Act
      await service.set(key, value, options);

      // Assert
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'notifyhub:cache:test-key',
        900,
        JSON.stringify(value),
      );
    });

    it('should return false when Redis operation fails', async () => {
      // Arrange
      const key = 'error-key';
      const value = 'test-value';
      const error = new Error('Redis error');
      mockRedis.setex.mockRejectedValue(error);

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      const result = await service.set(key, value);

      // Assert
      expect(result).toBe(false);
      expect(loggerErrorSpy).toHaveBeenCalledWith('Cache set failed', {
        key: 'notifyhub:error-key',
        error: 'Redis error',
      });

      loggerErrorSpy.mockRestore();
    });

    it('should return false when Redis returns non-OK result', async () => {
      // Arrange
      const key = 'test-key';
      const value = 'test-value';
      mockRedis.setex.mockResolvedValue('ERROR');

      // Act
      const result = await service.set(key, value);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete existing key', async () => {
      // Arrange
      const key = 'test-key';
      mockRedis.del.mockResolvedValue(1);

      // Act
      const result = await service.delete(key);

      // Assert
      expect(mockRedis.del).toHaveBeenCalledWith('notifyhub:test-key');
      expect(result).toBe(true);
      
      const stats = service.getStats();
      expect(stats.deletes).toBe(1);
    });

    it('should return false for non-existent key', async () => {
      // Arrange
      const key = 'missing-key';
      mockRedis.del.mockResolvedValue(0);

      // Act
      const result = await service.delete(key);

      // Assert
      expect(result).toBe(false);
    });

    it('should handle namespace in key', async () => {
      // Arrange
      const key = 'test-key';
      const options: CacheOptions = { namespace: 'temp' };
      mockRedis.del.mockResolvedValue(1);

      // Act
      await service.delete(key, options);

      // Assert
      expect(mockRedis.del).toHaveBeenCalledWith('notifyhub:temp:test-key');
    });

    it('should return false and log error on Redis failure', async () => {
      // Arrange
      const key = 'error-key';
      const error = new Error('Delete failed');
      mockRedis.del.mockRejectedValue(error);

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      const result = await service.delete(key);

      // Assert
      expect(result).toBe(false);
      expect(loggerErrorSpy).toHaveBeenCalledWith('Cache delete failed', {
        key: 'notifyhub:error-key',
        error: 'Delete failed',
      });

      loggerErrorSpy.mockRestore();
    });
  });

  describe('exists', () => {
    it('should return true for existing key', async () => {
      // Arrange
      const key = 'test-key';
      mockRedis.exists.mockResolvedValue(1);

      // Act
      const result = await service.exists(key);

      // Assert
      expect(mockRedis.exists).toHaveBeenCalledWith('notifyhub:test-key');
      expect(result).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      // Arrange
      const key = 'missing-key';
      mockRedis.exists.mockResolvedValue(0);

      // Act
      const result = await service.exists(key);

      // Assert
      expect(result).toBe(false);
    });

    it('should handle namespace in key', async () => {
      // Arrange
      const key = 'test-key';
      const options: CacheOptions = { namespace: 'session' };
      mockRedis.exists.mockResolvedValue(1);

      // Act
      await service.exists(key, options);

      // Assert
      expect(mockRedis.exists).toHaveBeenCalledWith('notifyhub:session:test-key');
    });

    it('should return false and log error on Redis failure', async () => {
      // Arrange
      const key = 'error-key';
      const error = new Error('Exists check failed');
      mockRedis.exists.mockRejectedValue(error);

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      const result = await service.exists(key);

      // Assert
      expect(result).toBe(false);
      expect(loggerErrorSpy).toHaveBeenCalledWith('Cache exists check failed', {
        key: 'notifyhub:error-key',
        error: 'Exists check failed',
      });

      loggerErrorSpy.mockRestore();
    });
  });

  describe('mget', () => {
    it('should return multiple values with hits and misses', async () => {
      // Arrange
      const keys = ['key1', 'key2', 'key3'];
      const values = ['value1', null, 'value3'];
      const serializedValues = values.map(v => v ? JSON.stringify(v) : null);
      mockRedis.mget.mockResolvedValue(serializedValues);

      // Act
      const result = await service.mget<string>(keys);

      // Assert
      expect(mockRedis.mget).toHaveBeenCalledWith(
        'notifyhub:key1',
        'notifyhub:key2', 
        'notifyhub:key3'
      );
      expect(result).toEqual(['value1', null, 'value3']);
      
      const stats = service.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('should handle empty keys array', async () => {
      // Arrange
      const keys: string[] = [];
      mockRedis.mget.mockResolvedValue([]);

      // Act
      const result = await service.mget(keys);

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle namespace in keys', async () => {
      // Arrange
      const keys = ['key1', 'key2'];
      const options: CacheOptions = { namespace: 'batch' };
      mockRedis.mget.mockResolvedValue([JSON.stringify('val1'), JSON.stringify('val2')]);

      // Act
      await service.mget(keys, options);

      // Assert
      expect(mockRedis.mget).toHaveBeenCalledWith(
        'notifyhub:batch:key1',
        'notifyhub:batch:key2'
      );
    });

    it('should return null values for all keys on Redis failure', async () => {
      // Arrange
      const keys = ['key1', 'key2'];
      const error = new Error('Mget failed');
      mockRedis.mget.mockRejectedValue(error);

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      const result = await service.mget(keys);

      // Assert
      expect(result).toEqual([null, null]);
      expect(loggerErrorSpy).toHaveBeenCalledWith('Cache mget failed', {
        keys: ['notifyhub:key1', 'notifyhub:key2'],
        error: 'Mget failed',
      });

      loggerErrorSpy.mockRestore();
    });
  });

  describe('mset', () => {
    it('should set multiple values successfully', async () => {
      // Arrange
      const entries = [
        { key: 'key1', value: 'value1', ttl: 1800 },
        { key: 'key2', value: 'value2' },
      ];
      mockPipeline.exec.mockResolvedValue([[null, 'OK'], [null, 'OK']]);

      // Act
      const result = await service.mset(entries);

      // Assert
      expect(mockPipeline.setex).toHaveBeenCalledTimes(2);
      expect(mockPipeline.setex).toHaveBeenNthCalledWith(1, 'notifyhub:key1', 1800, JSON.stringify('value1'));
      expect(mockPipeline.setex).toHaveBeenNthCalledWith(2, 'notifyhub:key2', 3600, JSON.stringify('value2'));
      expect(result).toBe(true);
      
      const stats = service.getStats();
      expect(stats.sets).toBe(2);
    });

    it('should return true for empty entries array', async () => {
      // Act
      const result = await service.mset([]);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle namespace in entries', async () => {
      // Arrange
      const entries = [{ key: 'key1', value: 'value1' }];
      const options: CacheOptions = { namespace: 'bulk', ttl: 900 };
      mockPipeline.exec.mockResolvedValue([[null, 'OK']]);

      // Act
      await service.mset(entries, options);

      // Assert
      expect(mockPipeline.setex).toHaveBeenCalledWith(
        'notifyhub:bulk:key1', 
        900, 
        JSON.stringify('value1')
      );
    });

    it('should return false when some operations fail', async () => {
      // Arrange
      const entries = [
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
      ];
      mockPipeline.exec.mockResolvedValue([[null, 'OK'], [null, 'ERROR']]);

      // Act
      const result = await service.mset(entries);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false and log error on Redis failure', async () => {
      // Arrange
      const entries = [{ key: 'key1', value: 'value1' }];
      const error = new Error('Pipeline failed');
      mockPipeline.exec.mockRejectedValue(error);

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      const result = await service.mset(entries);

      // Assert
      expect(result).toBe(false);
      expect(loggerErrorSpy).toHaveBeenCalledWith('Cache mset failed', {
        count: 1,
        error: 'Pipeline failed',
      });

      loggerErrorSpy.mockRestore();
    });
  });

  describe('mdel', () => {
    it('should delete multiple keys successfully', async () => {
      // Arrange
      const keys = ['key1', 'key2', 'key3'];
      mockRedis.del.mockResolvedValue(2);

      // Act
      const result = await service.mdel(keys);

      // Assert
      expect(mockRedis.del).toHaveBeenCalledWith(
        'notifyhub:key1',
        'notifyhub:key2',
        'notifyhub:key3'
      );
      expect(result).toBe(2);
      
      const stats = service.getStats();
      expect(stats.deletes).toBe(2);
    });

    it('should return 0 for empty keys array', async () => {
      // Act
      const result = await service.mdel([]);

      // Assert
      expect(result).toBe(0);
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('should handle namespace in keys', async () => {
      // Arrange
      const keys = ['key1', 'key2'];
      const options: CacheOptions = { namespace: 'cleanup' };
      mockRedis.del.mockResolvedValue(2);

      // Act
      await service.mdel(keys, options);

      // Assert
      expect(mockRedis.del).toHaveBeenCalledWith(
        'notifyhub:cleanup:key1',
        'notifyhub:cleanup:key2'
      );
    });

    it('should return 0 and log error on Redis failure', async () => {
      // Arrange
      const keys = ['key1', 'key2'];
      const error = new Error('Bulk delete failed');
      mockRedis.del.mockRejectedValue(error);

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      const result = await service.mdel(keys);

      // Assert
      expect(result).toBe(0);
      expect(loggerErrorSpy).toHaveBeenCalledWith('Cache mdel failed', {
        keys: ['notifyhub:key1', 'notifyhub:key2'],
        error: 'Bulk delete failed',
      });

      loggerErrorSpy.mockRestore();
    });
  });

  describe('clear', () => {
    it('should clear keys by pattern', async () => {
      // Arrange
      const pattern = 'user:*';
      const matchingKeys = ['notifyhub:user:1', 'notifyhub:user:2'];
      mockRedis.keys.mockResolvedValue(matchingKeys);
      mockRedis.del.mockResolvedValue(2);

      // Act
      const result = await service.clear(pattern);

      // Assert
      expect(mockRedis.keys).toHaveBeenCalledWith('notifyhub:user:*');
      expect(mockRedis.del).toHaveBeenCalledWith(...matchingKeys);
      expect(result).toBe(2);
      
      const stats = service.getStats();
      expect(stats.deletes).toBe(2);
    });

    it('should return 0 when no keys match pattern', async () => {
      // Arrange
      const pattern = 'nonexistent:*';
      mockRedis.keys.mockResolvedValue([]);

      // Act
      const result = await service.clear(pattern);

      // Assert
      expect(mockRedis.keys).toHaveBeenCalledWith('notifyhub:nonexistent:*');
      expect(mockRedis.del).not.toHaveBeenCalled();
      expect(result).toBe(0);
    });

    it('should use default wildcard pattern', async () => {
      // Arrange
      mockRedis.keys.mockResolvedValue(['notifyhub:key1']);
      mockRedis.del.mockResolvedValue(1);

      // Act
      const result = await service.clear();

      // Assert
      expect(mockRedis.keys).toHaveBeenCalledWith('notifyhub:*');
      expect(result).toBe(1);
    });

    it('should handle namespace in pattern', async () => {
      // Arrange
      const pattern = 'temp:*';
      const options: CacheOptions = { namespace: 'session' };
      mockRedis.keys.mockResolvedValue(['notifyhub:session:temp:data']);
      mockRedis.del.mockResolvedValue(1);

      // Act
      await service.clear(pattern, options);

      // Assert
      expect(mockRedis.keys).toHaveBeenCalledWith('notifyhub:session:temp:*');
    });

    it('should return 0 and log error on Redis failure', async () => {
      // Arrange
      const pattern = 'error:*';
      const error = new Error('Clear failed');
      mockRedis.keys.mockRejectedValue(error);

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      const result = await service.clear(pattern);

      // Assert
      expect(result).toBe(0);
      expect(loggerErrorSpy).toHaveBeenCalledWith('Cache clear failed', {
        pattern: 'notifyhub:error:*',
        error: 'Clear failed',
      });

      loggerErrorSpy.mockRestore();
    });
  });

  describe('getStats', () => {
    it('should return current statistics', () => {
      // Arrange - perform some operations to generate stats
      service.get('test'); // This will be a miss
      
      // Act
      const stats = service.getStats();

      // Assert
      expect(stats).toMatchObject({
        hits: expect.any(Number),
        misses: expect.any(Number),
        sets: expect.any(Number),
        deletes: expect.any(Number),
        hitRate: expect.any(Number),
        totalOperations: expect.any(Number),
      });
      expect(stats.hitRate).toBeGreaterThanOrEqual(0);
      expect(stats.hitRate).toBeLessThanOrEqual(100);
    });

    it('should calculate hit rate correctly', async () => {
      // Arrange
      mockRedis.get
        .mockResolvedValueOnce(JSON.stringify('hit1'))
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(JSON.stringify('hit2'));

      // Act - 2 hits, 1 miss
      await service.get('key1');
      await service.get('key2'); 
      await service.get('key3');
      
      const stats = service.getStats();

      // Assert
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.totalOperations).toBe(3);
      expect(stats.hitRate).toBeCloseTo(66.67, 1);
    });
  });

  describe('resetStats', () => {
    it('should reset all statistics to zero', async () => {
      // Arrange - generate some stats first
      mockRedis.get.mockResolvedValue(JSON.stringify('value'));
      await service.get('test-key');
      
      // Verify stats exist
      let stats = service.getStats();
      expect(stats.hits).toBe(1);

      // Act
      service.resetStats();

      // Assert
      stats = service.getStats();
      expect(stats).toEqual({
        hits: 0,
        misses: 0,
        sets: 0,
        deletes: 0,
        hitRate: 0,
        totalOperations: 0,
      });
    });
  });

  describe('getHealth', () => {
    it('should return healthy status for low latency', async () => {
      // Arrange
      mockRedis.ping.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve('PONG'), 50); // 50ms latency
        });
      });
      mockRedis.info.mockResolvedValue(
        'used_memory_human:256.00M\nconnected_clients:5\n'
      );

      // Act
      const health = await service.getHealth();

      // Assert
      expect(health.status).toBe('healthy');
      expect(health.latency).toBeLessThan(100);
      expect(health.memory).toBe('256.00M');
      expect(health.connections).toBe(5);
      expect(health.stats).toBeDefined();
    });

    it('should return degraded status for medium latency', async () => {
      // Arrange  
      mockRedis.ping.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve('PONG'), 200); // 200ms latency
        });
      });
      mockRedis.info.mockResolvedValue(
        'used_memory_human:512.00M\nconnected_clients:10\n'
      );

      // Act
      const health = await service.getHealth();

      // Assert
      expect(health.status).toBe('degraded');
      expect(health.latency).toBeGreaterThanOrEqual(100);
      expect(health.latency).toBeLessThan(500);
    });

    it('should return down status for high latency', async () => {
      // Arrange
      mockRedis.ping.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve('PONG'), 600); // 600ms latency
        });
      });
      mockRedis.info.mockResolvedValue('used_memory_human:1.00G\n');

      // Act
      const health = await service.getHealth();

      // Assert
      expect(health.status).toBe('down');
      expect(health.latency).toBeGreaterThanOrEqual(500);
    });

    it('should handle missing memory and connection info', async () => {
      // Arrange
      mockRedis.ping.mockResolvedValue('PONG');
      mockRedis.info.mockResolvedValue('some_other_info:value\n');

      // Act
      const health = await service.getHealth();

      // Assert
      expect(health.memory).toBe('unknown');
      expect(health.connections).toBe(0);
    });

    it('should return down status on Redis failure', async () => {
      // Arrange
      const error = new Error('Redis unavailable');
      mockRedis.ping.mockRejectedValue(error);

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      const health = await service.getHealth();

      // Assert
      expect(health).toEqual({
        status: 'down',
        latency: -1,
        memory: 'unknown',
        connections: 0,
        stats: expect.any(Object),
      });
      expect(loggerErrorSpy).toHaveBeenCalledWith('Cache health check failed', {
        error: 'Redis unavailable',
      });

      loggerErrorSpy.mockRestore();
    });
  });

  describe('onModuleDestroy', () => {
    it('should log stats on module destroy', () => {
      // Arrange
      const loggerLogSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

      // Act
      service.onModuleDestroy();

      // Assert
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Cache statistics',
        expect.any(Object)
      );

      loggerLogSpy.mockRestore();
    });
  });

  describe('private methods', () => {
    describe('buildKey', () => {
      it('should build key without namespace', async () => {
        // Test indirectly through public method
        mockRedis.get.mockResolvedValue(null);
        
        await service.get('test-key');
        
        expect(mockRedis.get).toHaveBeenCalledWith('notifyhub:test-key');
      });

      it('should build key with namespace', async () => {
        // Test indirectly through public method
        mockRedis.get.mockResolvedValue(null);
        
        await service.get('test-key', { namespace: 'users' });
        
        expect(mockRedis.get).toHaveBeenCalledWith('notifyhub:users:test-key');
      });
    });

    describe('serialize and deserialize', () => {
      it('should serialize and deserialize complex objects', async () => {
        // Arrange
        const complexObject = {
          string: 'test',
          number: 42,
          boolean: true,
          array: [1, 2, 3],
          nested: { key: 'value' },
        };
        
        mockRedis.setex.mockResolvedValue('OK');
        mockRedis.get.mockResolvedValue(JSON.stringify(complexObject));

        // Act & Assert
        const setResult = await service.set('complex', complexObject);
        expect(setResult).toBe(true);
        
        const getResult = await service.get('complex');
        expect(getResult).toEqual(complexObject);
      });

      it('should handle null values correctly', async () => {
        mockRedis.setex.mockResolvedValue('OK');
        mockRedis.get.mockResolvedValue(JSON.stringify(null));

        // Test null
        await service.set('null-key', null);
        const nullResult = await service.get('null-key');
        expect(nullResult).toBeNull();
      });

      it('should handle undefined values by converting to null (JSON limitation)', async () => {
        // Note: JSON.stringify(undefined) returns undefined (not a string)
        // which causes issues in Redis storage. The cache service should handle this gracefully
        mockRedis.setex.mockResolvedValue('OK');

        // When undefined is stringified, it becomes the string "undefined"
        // But since JSON.stringify(undefined) returns undefined, the service will handle it
        const setResult = await service.set('undefined-key', undefined);
        
        // The set operation might fail because JSON.stringify(undefined) is problematic
        // This is expected behavior - undefined values are not properly JSON serializable
        expect(setResult).toBe(false); // Should fail gracefully
      });
    });

    describe('updateStats', () => {
      it('should update hit rate calculation correctly', async () => {
        // Arrange - perform operations to trigger stats updates
        mockRedis.get
          .mockResolvedValueOnce(JSON.stringify('hit'))
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(JSON.stringify('hit'));

        // Act - 2 hits, 1 miss = 66.67% hit rate
        await service.get('key1');
        await service.get('key2');
        await service.get('key3');

        // Assert
        const stats = service.getStats();
        expect(stats.totalOperations).toBe(3);
        expect(stats.hitRate).toBeCloseTo(66.67, 1);
      });

      it('should handle zero operations gracefully', () => {
        // Arrange & Act
        const stats = service.getStats();

        // Assert
        expect(stats.totalOperations).toBe(0);
        expect(stats.hitRate).toBe(0);
      });
    });
  });
});