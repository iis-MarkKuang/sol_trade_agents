import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Query,
} from '@nestjs/common';
import { InjectiveAgentIdentityService } from './injective-agent-identity.service';

@Controller('agent')
export class AgentIdentityController {
  private readonly logger = new Logger(AgentIdentityController.name);

  constructor(private readonly agentIdentity: InjectiveAgentIdentityService) {}

  /** Our agent's ERC-8004 identity card (real if INJECTIVE_AGENT_ID set, else simulated). */
  @Get('identity')
  async identity() {
    try {
      return await this.agentIdentity.getOurIdentity();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`get identity failed: ${message}`);
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** Browse the Injective Agent Registry (live scan when enabled, else samples). */
  @Get('registry')
  async registry(@Query('offset') offset?: string, @Query('limit') limit?: string) {
    try {
      const o = offset ? Number(offset) : 0;
      const l = limit ? Number(limit) : 20;
      return await this.agentIdentity.listRegistryAgents(o, l);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`list registry failed: ${message}`);
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
