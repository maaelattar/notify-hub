import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Notification } from './entities/notification.entity';
import { NotificationRepository } from './repositories/notification.repository';
import { NotificationService } from './services/notification.service';
import { NotificationProducer } from './services/notification.producer';
import { NotificationProcessor } from './processors/notification.processor';
import { NotificationController } from './controllers/notification.controller';
import { NotificationValidatorService } from './services/notification-validator.service';
import { NotificationOrchestrationService } from './services/notification-orchestration.service';
import { NotificationBusinessLogicService } from './services/notification-business-logic.service';
import { NotificationDataAccessService } from './services/notification-data-access.service';
import { NotificationConfig } from './config/notification.config';
import { ChannelsModule } from '../channels/channels.module';
import { SharedModule } from '../shared/shared.module';

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
            removeOnComplete: {
              age: 3600, // Keep completed jobs for 1 hour
              count: 100, // Keep last 100 completed jobs
            },
            removeOnFail: false, // Keep failed jobs for debugging
            timeout: 30000, // 30 seconds timeout
          },
        };
      },
    }),
    ChannelsModule, // For ChannelRouter
    SharedModule, // For MetricsService
  ],
  controllers: [NotificationController],
  providers: [
    NotificationRepository,
    NotificationService,
    NotificationBusinessLogicService,
    NotificationDataAccessService,
    NotificationProducer,
    NotificationProcessor,
    NotificationValidatorService,
    NotificationOrchestrationService,
  ],
  exports: [
    NotificationService,
    NotificationProducer,
    NotificationBusinessLogicService,
    NotificationDataAccessService,
  ],
})
export class NotificationsModule {}
