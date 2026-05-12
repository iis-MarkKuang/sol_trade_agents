import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { CrawlersModule } from './crawlers/crawlers.module';
import { ConfigModule } from './config/config.module';
import { DataModule } from './data/data.module';
import { AgentsModule } from './agents/agents.module';
import { StrategyModule } from './strategy/strategy.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [ConfigModule, PrismaModule, CrawlersModule, DataModule, AgentsModule, StrategyModule, SchedulerModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
