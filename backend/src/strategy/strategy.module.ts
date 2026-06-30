import { Module } from '@nestjs/common';
import { StrategyEngineService } from './strategy-engine.service';
import { SimpleMomentumStrategy } from './strategies/simple-momentum.strategy';
import { CrossChainArbStrategy } from './strategies/cross-chain-arb.strategy';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [StrategyEngineService, SimpleMomentumStrategy, CrossChainArbStrategy],
  exports: [StrategyEngineService, CrossChainArbStrategy],
})
export class StrategyModule {}
