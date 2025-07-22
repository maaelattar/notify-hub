import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisProvider implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisProvider.name);
  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    this.client = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      password: this.configService.get('REDIS_PASSWORD'),
      retryStrategy: (times: number) => {
        if (times > 10) {
          this.logger.error('Redis connection failed after 10 retries');
          return null; // Stop retrying
        }
        const delay = Math.min(times * 3000, 30000);
        this.logger.warn(`Redis connection retry ${times} in ${delay}ms`);
        return delay;
      },
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000,
      connectTimeout: 10000,
      commandTimeout: 5000,
    });

    this.client.on('connect', () => {
      this.logger.log('Redis client connected');
    });

    this.client.on('error', (error) => {
      this.logger.error('Redis client error:', error);
    });

    this.client.on('close', () => {
      this.logger.warn('Redis client connection closed');
    });

    // Connection will be initialized in onModuleInit()
  }

  private async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      this.logger.error('Failed to connect to Redis:', error);
    }
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  getClient(): Redis {
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
      this.logger.log('Redis client disconnected gracefully');
    } catch (error) {
      this.logger.error('Error disconnecting Redis client:', error);
    }
  }

  // Health check method
  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      this.logger.error('Redis ping failed:', error);
      return false;
    }
  }

  // Connection status
  isConnected(): boolean {
    return this.client.status === 'ready';
  }
}
