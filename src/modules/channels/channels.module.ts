import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailModule } from './email/email.module';
import { ChannelRouter } from './services/channel-router.service';
import { SharedModule } from '../shared/shared.module';
import emailConfig from './email/config/email.config';

@Module({
  imports: [ConfigModule.forFeature(emailConfig), EmailModule, SharedModule],
  controllers: [],
  providers: [ChannelRouter],
  exports: [ChannelRouter, EmailModule],
})
export class ChannelsModule {}
