import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { InjectiveAgentIdentityService } from './injective-agent-identity.service';
import { AgentIdentityController } from './agent-identity.controller';

@Module({
  imports: [ConfigModule],
  controllers: [AgentIdentityController],
  providers: [InjectiveAgentIdentityService],
  exports: [InjectiveAgentIdentityService],
})
export class AgentIdentityModule {}
