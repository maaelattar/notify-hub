import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Notification } from './entities/notification.entity';
import { NotificationRepository } from './repositories/notification.repository';
import { NotificationService } from './services/notification.service';
import { NotificationProcessor } from './processors/notification.processor';
import { NotificationConfig } from './config/notification.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),
    BullModule.registerQueueAsync({
      name: 'notifications',
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config = configService.get<NotificationConfig>('notification')!;
        return {
          defaultJobOptions: {
            attempts: config.maxRetries,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          },
        };
      },
    }),
  ],
  controllers: [],
  providers: [
    NotificationRepository,
    NotificationService,
    NotificationProcessor,
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
