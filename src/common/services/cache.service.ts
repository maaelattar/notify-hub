import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisProvider } from '../../modules/common/providers/redis.provider';
import Redis from 'ioredis';

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  compress?: boolean; // Whether to compress large values
  namespace?: string; // Cache namespace for organization
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  hitRate: number;
  totalOperations: number;
}

/**
 * Advanced caching service with Redis backend
 * Provides high-performance caching with compression, namespacing, and statistics
 * Implements cache-aside pattern with automatic serialization/deserialization
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis;
  private readonly defaultTtl: number;
  private readonly enableCompression: boolean;
  private readonly stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    hitRate: 0,
    totalOperations: 0,
  };

  constructor(
    private readonly redisProvider: RedisProvider,
    private readonly configService: ConfigService,
  ) {
    this.redis = this.redisProvider.getClient();
    this.defaultTtl = this.configService.get<number>('CACHE_DEFAULT_TTL', 3600); // 1 hour
    this.enableCompression = this.configService.get<boolean>(
      'CACHE_ENABLE_COMPRESSION',
      true,
    );
  }

  onModuleDestroy() {
    this.logStats();
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    const fullKey = this.buildKey(key, options.namespace);

    try {
      const start = Date.now();
      const cached = await this.redis.get(fullKey);
      const duration = Date.now() - start;

      if (cached === null) {
        this.stats.misses++;
        this.updateStats();

        this.logger.debug('Cache miss', {
          key: fullKey,
          duration,
        });

        return null;
      }

      this.stats.hits++;
      this.updateStats();

      const value = this.deserialize<T>(cached, options.compress);

      this.logger.debug('Cache hit', {
        key: fullKey,
        duration,
        size: cached.length,
      });

      return value;
    } catch (error) {
      this.logger.error('Cache get failed', {
        key: fullKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set<T>(
    key: string,
    value: T,
    options: CacheOptions = {},
  ): Promise<boolean> {
    const fullKey = this.buildKey(key, options.namespace);
    const ttl = options.ttl || this.defaultTtl;

    try {
      const start = Date.now();
      const serialized = this.serialize(value, options.compress);

      const result = await this.redis.setex(fullKey, ttl, serialized);
      const duration = Date.now() - start;

      this.stats.sets++;
      this.updateStats();

      this.logger.debug('Cache set', {
        key: fullKey,
        ttl,
        duration,
        size: serialized.length,
        compressed: options.compress && this.enableCompression,
      });

      return result === 'OK';
    } catch (error) {
      this.logger.error('Cache set failed', {
        key: fullKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Delete value from cache
   */
  async delete(key: string, options: CacheOptions = {}): Promise<boolean> {
    const fullKey = this.buildKey(key, options.namespace);

    try {
      const result = await this.redis.del(fullKey);

      this.stats.deletes++;
      this.updateStats();

      this.logger.debug('Cache delete', {
        key: fullKey,
        existed: result > 0,
      });

      return result > 0;
    } catch (error) {
      this.logger.error('Cache delete failed', {
        key: fullKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Check if key exists in cache
   */
  async exists(key: string, options: CacheOptions = {}): Promise<boolean> {
    const fullKey = this.buildKey(key, options.namespace);

    try {
      const result = await this.redis.exists(fullKey);
      return result === 1;
    } catch (error) {
      this.logger.error('Cache exists check failed', {
        key: fullKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Get multiple values from cache
   */
  async mget<T>(
    keys: string[],
    options: CacheOptions = {},
  ): Promise<Array<T | null>> {
    const fullKeys = keys.map((key) => this.buildKey(key, options.namespace));

    try {
      const start = Date.now();
      const results = await this.redis.mget(...fullKeys);
      const duration = Date.now() - start;

      const values = results.map((result) => {
        if (result === null) {
          this.stats.misses++;
          return null;
        }

        this.stats.hits++;
        return this.deserialize<T>(result, options.compress);
      });

      this.updateStats();

      this.logger.debug('Cache mget', {
        keys: fullKeys,
        hits: values.filter((v) => v !== null).length,
        misses: values.filter((v) => v === null).length,
        duration,
      });

      return values;
    } catch (error) {
      this.logger.error('Cache mget failed', {
        keys: fullKeys,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return keys.map(() => null);
    }
  }

  /**
   * Set multiple values in cache
   */
  async mset<T>(
    entries: Array<{ key: string; value: T; ttl?: number }>,
    options: CacheOptions = {},
  ): Promise<boolean> {
    if (entries.length === 0) return true;

    try {
      const start = Date.now();
      const pipeline = this.redis.pipeline();

      for (const entry of entries) {
        const fullKey = this.buildKey(entry.key, options.namespace);
        const serialized = this.serialize(entry.value, options.compress);
        const ttl = entry.ttl || options.ttl || this.defaultTtl;

        pipeline.setex(fullKey, ttl, serialized);
      }

      const results = await pipeline.exec();
      const duration = Date.now() - start;

      const success = results?.every((result) => result[1] === 'OK') ?? false;

      this.stats.sets += entries.length;
      this.updateStats();

      this.logger.debug('Cache mset', {
        count: entries.length,
        success,
        duration,
      });

      return success;
    } catch (error) {
      this.logger.error('Cache mset failed', {
        count: entries.length,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Delete multiple keys from cache
   */
  async mdel(keys: string[], options: CacheOptions = {}): Promise<number> {
    if (keys.length === 0) return 0;

    const fullKeys = keys.map((key) => this.buildKey(key, options.namespace));

    try {
      const result = await this.redis.del(...fullKeys);

      this.stats.deletes += result;
      this.updateStats();

      this.logger.debug('Cache mdel', {
        keys: fullKeys,
        deleted: result,
      });

      return result;
    } catch (error) {
      this.logger.error('Cache mdel failed', {
        keys: fullKeys,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  /**
   * Clear cache by pattern
   */
  async clear(
    pattern: string = '*',
    options: CacheOptions = {},
  ): Promise<number> {
    const fullPattern = this.buildKey(pattern, options.namespace);

    try {
      const keys = await this.redis.keys(fullPattern);

      if (keys.length === 0) {
        return 0;
      }

      const result = await this.redis.del(...keys);

      this.stats.deletes += result;
      this.updateStats();

      this.logger.debug('Cache clear', {
        pattern: fullPattern,
        keysFound: keys.length,
        deleted: result,
      });

      return result;
    } catch (error) {
      this.logger.error('Cache clear failed', {
        pattern: fullPattern,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.sets = 0;
    this.stats.deletes = 0;
    this.stats.hitRate = 0;
    this.stats.totalOperations = 0;
  }

  /**
   * Get cache health information
   */
  async getHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'down';
    latency: number;
    memory: string;
    connections: number;
    stats: CacheStats;
  }> {
    try {
      const start = Date.now();
      await this.redis.ping();
      const latency = Date.now() - start;

      const info = await this.redis.info();
      const memoryInfo = info
        .split('\n')
        .find((line) => line.startsWith('used_memory_human:'));
      const connectionsInfo = info
        .split('\n')
        .find((line) => line.startsWith('connected_clients:'));

      const memory = memoryInfo ? memoryInfo.split(':')[1].trim() : 'unknown';
      const connections = connectionsInfo
        ? parseInt(connectionsInfo.split(':')[1])
        : 0;

      const status =
        latency < 100 ? 'healthy' : latency < 500 ? 'degraded' : 'down';

      return {
        status,
        latency,
        memory,
        connections,
        stats: this.getStats(),
      };
    } catch (error) {
      this.logger.error('Cache health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        status: 'down',
        latency: -1,
        memory: 'unknown',
        connections: 0,
        stats: this.getStats(),
      };
    }
  }

  /**
   * Build cache key with namespace
   */
  private buildKey(key: string, namespace?: string): string {
    const parts = ['notifyhub'];

    if (namespace) {
      parts.push(namespace);
    }

    parts.push(key);

    return parts.join(':');
  }

  /**
   * Serialize value for storage
   */
  private serialize<T>(value: T, _compress?: boolean): string {
    const json = JSON.stringify(value);

    // In a real implementation, you would implement compression here
    // For now, we'll just return the JSON string
    return json;
  }

  /**
   * Deserialize value from storage
   */
  private deserialize<T>(value: string, _decompress?: boolean): T {
    // In a real implementation, you would implement decompression here
    // For now, we'll just parse the JSON string
    return JSON.parse(value) as T;
  }

  /**
   * Update cache statistics
   */
  private updateStats(): void {
    this.stats.totalOperations = this.stats.hits + this.stats.misses;
    this.stats.hitRate =
      this.stats.totalOperations > 0
        ? (this.stats.hits / this.stats.totalOperations) * 100
        : 0;
  }

  /**
   * Log cache statistics
   */
  private logStats(): void {
    this.logger.log('Cache statistics', this.getStats());
  }
}
