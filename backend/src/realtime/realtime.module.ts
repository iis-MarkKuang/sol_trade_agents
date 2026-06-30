import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StrategyModule } from '../strategy/strategy.module';
import { AgentIdentityModule } from '../agent/agent-identity.module';
import { RealtimeController } from './realtime.controller';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { RealtimeTradeRepository } from './realtime-trade.repository';
import { CrossChainAgentService } from './cross-chain-agent.service';
import { AgentMcpServerService } from './agent-mcp-server.service';
import { AgentMcpController } from './agent-mcp.controller';

@Module({
  imports: [ConfigModule, PrismaModule, StrategyModule, AgentIdentityModule],
  controllers: [RealtimeController, AgentMcpController],
  providers: [
    RealtimeService,
    RealtimeGateway,
    RealtimeTradeRepository,
    CrossChainAgentService,
    AgentMcpServerService,
  ],
  exports: [RealtimeService, RealtimeGateway, CrossChainAgentService],
})
export class RealtimeModule {}
