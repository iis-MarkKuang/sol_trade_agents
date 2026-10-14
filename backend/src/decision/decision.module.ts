import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { JevDecisionAdapter } from './adapters/jev-decision.adapter.js';
import { DecisionService } from './decision.service.js';
import { ResearchQualityGateService } from './research-quality-gate.service.js';

@Module({
  imports: [ConfigModule],
  providers: [JevDecisionAdapter, DecisionService, ResearchQualityGateService],
  exports: [DecisionService, ResearchQualityGateService],
})
export class DecisionModule {}
