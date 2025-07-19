import { Module } from '@nestjs/common';
import { ChannelRouter } from './services/channel-router.service';

@Module({
  imports: [],
  controllers: [],
  providers: [ChannelRouter],
  exports: [ChannelRouter],
})
export class ChannelsModule {}
