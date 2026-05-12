import { Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { DataModule } from '../data/data.module';
import { CrawlersModule } from '../crawlers/crawlers.module';
import { AgentsModule } from '../agents/agents.module';
import { StrategyModule } from '../strategy/strategy.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [DataModule, CrawlersModule, AgentsModule, StrategyModule, PrismaModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule implements OnModuleInit, OnModuleDestroy {
  constructor(private schedulerService: SchedulerService) {}

  onModuleInit() {
    this.schedulerService.onModuleInit();
  }

  onModuleDestroy() {
    this.schedulerService.onModuleDestroy();
  }
}
