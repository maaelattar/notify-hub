import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ErrorHandlingInterceptor } from './common/interceptors/error-handling.interceptor';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { SharedModule } from './modules/shared/shared.module';
import { SecurityModule } from './modules/security/security.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { EventsModule } from './modules/events/events.module';
import {
  appConfig,
  databaseConfig,
  validateConfig,
  DatabaseConfig,
} from './config';
import { notificationConfig } from './modules/notifications/config/notification.config';
import { APP_CONSTANTS } from './common/constants/app.constants';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateConfig,
      load: [appConfig, databaseConfig, notificationConfig],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbConfig = configService.get<DatabaseConfig>('database')!;

        return {
          type: 'postgres',
          url: dbConfig.url,
          autoLoadEntities: true,
          synchronize: dbConfig.synchronize,
          logging: dbConfig.logging,
          migrations: ['dist/migrations/*.js'],
          migrationsRun: false, // We'll run manually on startup
        };
      },
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
          password: configService.get('REDIS_PASSWORD'),
          retryStrategy: (times: number) => {
            // Retry connection every 3 seconds, up to 10 times
            if (times > APP_CONSTANTS.QUEUE.MAX_CONNECTION_RETRIES) {
              throw new Error(
                `Redis connection failed after ${APP_CONSTANTS.QUEUE.MAX_CONNECTION_RETRIES} retries`,
              );
            }
            return Math.min(
              times * APP_CONSTANTS.QUEUE.EXPONENTIAL_BACKOFF_MULTIPLIER,
              APP_CONSTANTS.QUEUE.MAX_BACKOFF_DELAY,
            );
          },
          maxRetriesPerRequest: APP_CONSTANTS.QUEUE.DEFAULT_MAX_RETRIES,
        },
        defaultJobOptions: {
          attempts: APP_CONSTANTS.QUEUE.DEFAULT_MAX_RETRIES,
          backoff: {
            type: 'exponential',
            delay: APP_CONSTANTS.QUEUE.BULL_INITIAL_BACKOFF_DELAY, // 2 seconds, then 4, then 8
          },
          removeOnComplete: {
            age: APP_CONSTANTS.QUEUE.COMPLETED_JOBS_AGE_SECONDS, // Keep completed jobs for 1 hour
            count: APP_CONSTANTS.QUEUE.COMPLETED_JOBS_TO_KEEP, // Keep last 100 completed jobs
          },
          removeOnFail: false, // Keep failed jobs for debugging
          timeout: APP_CONSTANTS.QUEUE.DEFAULT_JOB_TIMEOUT, // 30 seconds timeout
        },
      }),
    }),
    ThrottlerModule.forRoot([
      {
        name: 'global',
        ttl: APP_CONSTANTS.THROTTLING.GLOBAL_TTL, // 1 minute
        limit: APP_CONSTANTS.THROTTLING.GLOBAL_LIMIT, // 100 requests per minute
      },
      {
        name: 'create',
        ttl: APP_CONSTANTS.THROTTLING.CREATE_TTL,
        limit: APP_CONSTANTS.THROTTLING.CREATE_LIMIT, // 10 creates per minute
      },
      {
        name: 'expensive',
        ttl: APP_CONSTANTS.THROTTLING.EXPENSIVE_TTL, // 5 minutes
        limit: APP_CONSTANTS.THROTTLING.EXPENSIVE_LIMIT, // 5 expensive operations per 5 minutes
      },
    ]),
    SecurityModule, // Consolidates AuthModule + guards + middleware
    MonitoringModule, // Health, performance, and metrics monitoring
    EventsModule, // Event-driven architecture
    SharedModule, // Shared providers and utilities
    NotificationsModule,
    ChannelsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ErrorHandlingInterceptor,
    },
  ],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.dataSource.runMigrations();
  }
}
