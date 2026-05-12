import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { ConfigModule } from '../config/config.module';
import { CrawlersModule } from '../crawlers/crawlers.module';
import { DataModule } from '../data/data.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StrategyModule } from '../strategy/strategy.module';
import { OfflineAgentController } from './offline-agent.controller';
import { OfflineAgentGateway } from './offline-agent.gateway';
import { OfflineAgentService } from './offline-agent.service';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [
    ConfigModule,
    DataModule,
    CrawlersModule,
    AgentsModule,
    StrategyModule,
    PrismaModule,
  ],
  controllers: [OfflineAgentController],
  providers: [OfflineAgentService, SchedulerService, OfflineAgentGateway],
  exports: [OfflineAgentService, SchedulerService, OfflineAgentGateway],
})
export class SchedulerModule {}
