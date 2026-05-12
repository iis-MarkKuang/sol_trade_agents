import { Module } from '@nestjs/common';
import { LlmAgentService } from './llm-agent.service';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [LlmAgentService],
  exports: [LlmAgentService],
})
export class AgentsModule {}
