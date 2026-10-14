import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { JevDecisionAdapter } from './adapters/jev-decision.adapter.js';
import type { DecisionAdapter, DecisionRequest, DecisionResult } from './decision.types.js';

@Injectable()
export class DecisionService {
  private readonly adapters: Map<string, DecisionAdapter>;

  constructor(
    private readonly configService: ConfigService,
    jevAdapter: JevDecisionAdapter,
  ) {
    this.adapters = new Map([[jevAdapter.name, jevAdapter]]);
  }

  isConfigured(): boolean {
    const provider = this.configService.decision.provider;
    if (provider === 'none') return false;
    return this.adapters.get(provider)?.isConfigured() ?? false;
  }

  async evaluate(request: DecisionRequest): Promise<DecisionResult> {
    const provider = this.configService.decision.provider;
    if (provider === 'none') {
      throw new Error('No decision provider is enabled');
    }

    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`Unsupported decision provider: ${provider}`);
    }
    if (!adapter.isConfigured()) {
      throw new Error(`Decision provider ${provider} is not configured`);
    }
    return adapter.evaluate(request);
  }
}
