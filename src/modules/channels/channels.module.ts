import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailModule } from './email/email.module';
import { ChannelRegistry } from './services/channel-registry.service';
import { SharedModule } from '../shared/shared.module';
import emailConfig from './email/config/email.config';
import { EmailChannelStrategy } from './email/email.strategy';

@Global()
@Module({
  imports: [ConfigModule.forFeature(emailConfig), EmailModule, SharedModule],
  controllers: [],
  providers: [ChannelRegistry, EmailChannelStrategy],
  exports: [ChannelRegistry, EmailModule],
})
export class ChannelsModule {}
