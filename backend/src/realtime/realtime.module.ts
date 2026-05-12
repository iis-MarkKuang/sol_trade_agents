import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeController } from './realtime.controller';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { RealtimeTradeRepository } from './realtime-trade.repository';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [RealtimeController],
  providers: [RealtimeService, RealtimeGateway, RealtimeTradeRepository],
  exports: [RealtimeService, RealtimeGateway],
})
export class RealtimeModule {}
