import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { SharedModule } from './modules/shared/shared.module';
import {
  appConfig,
  databaseConfig,
  validateConfig,
  DatabaseConfig,
} from './config';
import { notificationConfig } from './modules/notifications/config/notification.config';

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
            if (times > 10) {
              throw new Error('Redis connection failed after 10 retries');
            }
            return Math.min(times * 3000, 30000);
          },
          maxRetriesPerRequest: 3,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000, // 2 seconds, then 4, then 8
          },
          removeOnComplete: {
            age: 3600, // Keep completed jobs for 1 hour
            count: 100, // Keep last 100 completed jobs
          },
          removeOnFail: false, // Keep failed jobs for debugging
          timeout: 30000, // 30 seconds timeout
        },
      }),
    }),
    SharedModule,
    NotificationsModule,
    ChannelsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    // Run pending migrations on startup
    await this.dataSource.runMigrations();
  }
}
