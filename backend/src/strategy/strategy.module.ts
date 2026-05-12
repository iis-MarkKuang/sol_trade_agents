import { Module } from '@nestjs/common';
import { StrategyEngineService } from './strategy-engine.service';
import { SimpleMomentumStrategy } from './strategies/simple-momentum.strategy';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [StrategyEngineService, SimpleMomentumStrategy],
  exports: [StrategyEngineService],
})
export class StrategyModule {}
