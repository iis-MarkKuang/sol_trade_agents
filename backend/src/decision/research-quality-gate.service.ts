import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import type { CrawledMarketData } from '../crawlers/types/crawler.types.js';
import type { TradeSignal } from '../strategy/strategy.interface.js';
import { DecisionService } from './decision.service.js';
import type { DecisionAnswer } from './decision.types.js';

export type QualityGateStatus = 'disabled' | 'pass' | 'review' | 'reject' | 'error';

export interface ResearchQualityGateResult {
  mode: 'disabled' | 'shadow' | 'enforce';
  status: QualityGateStatus;
  approved: boolean;
  provider?: string;
  model?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  checks?: {
    analysisGrounded: number;
    signalsSupported: number;
  };
  latencyMs?: number;
  reason?: string;
}

export interface ResearchQualityGateInput {
  marketData: CrawledMarketData[];
  analysis: string;
  signals: TradeSignal[];
}

@Injectable()
export class ResearchQualityGateService {
  private readonly logger = new Logger(ResearchQualityGateService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly decisions: DecisionService,
  ) {}

  async evaluate(input: ResearchQualityGateInput): Promise<ResearchQualityGateResult> {
    const config = this.configService.decision;
    if (config.qualityGateMode === 'disabled' || config.provider === 'none') {
      return {
        mode: 'disabled',
        status: 'disabled',
        approved: true,
        reason: 'Decision quality gate is disabled',
      };
    }

    if (!this.decisions.isConfigured()) {
      return this.unavailableResult(
        config.qualityGateMode,
        `Decision provider ${config.provider} is not configured`,
      );
    }

    try {
      const result = await this.decisions.evaluate({
        state: this.buildState(input),
        questions: {
          verdict: {
            type: 'choice',
            instructions:
              'Classify whether this research output is sufficiently supported by the supplied market observations to continue through the pipeline.',
            criteria: {
              pass: 'Analysis and signal reasons are supported, internally consistent, and clearly tied to supplied observations.',
              review:
                'Evidence is incomplete, mixed, or ambiguous enough that a person or stronger reasoning model should review it.',
              reject:
                'Analysis or signal reasons materially contradict, invent, or overstate the supplied observations.',
            },
          },
          analysis_grounded: {
            type: 'noul',
            instructions:
              'Is the market analysis grounded in the supplied observations without unsupported factual claims?',
          },
          signals_supported: {
            type: 'noul',
            instructions:
              'Are the proposed signal actions and reasons supported by the supplied observations? If no signals were proposed, answer yes.',
          },
        },
      });

      const verdict = this.choiceAnswer(result.answers.verdict);
      const analysisGrounded = this.noulProbability(result.answers.analysis_grounded);
      const signalsSupported = this.noulProbability(result.answers.signals_supported);
      const threshold = config.qualityGateMinConfidence;
      const status: QualityGateStatus =
        verdict.choice === 'pass' &&
        verdict.confidence >= threshold &&
        analysisGrounded >= threshold &&
        signalsSupported >= threshold
          ? 'pass'
          : verdict.choice === 'reject' && verdict.confidence >= threshold
            ? 'reject'
            : 'review';

      return {
        mode: config.qualityGateMode,
        status,
        approved: config.qualityGateMode === 'shadow' || status === 'pass',
        provider: result.provider,
        model: result.model,
        confidence: verdict.confidence,
        probabilities: verdict.probabilities,
        checks: { analysisGrounded, signalsSupported },
        latencyMs: result.latencyMs,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Research quality gate failed: ${reason}`);
      return this.unavailableResult(config.qualityGateMode, reason);
    }
  }

  private buildState(input: ResearchQualityGateInput) {
    const onchain = input.marketData
      .filter((row) => row.buyVolumeUsd24h !== undefined)
      .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))
      .slice(0, 10);
    const other = input.marketData
      .filter((row) => row.buyVolumeUsd24h === undefined)
      .slice(0, 10);

    return {
      observations: [...other, ...onchain].map((row) => ({
        token: row.token,
        symbol: row.symbol,
        source: row.source,
        observedAt: row.timestamp.toISOString(),
        price: row.price,
        volume24h: row.volume24h,
        buyVolumeUsd24h: row.buyVolumeUsd24h,
        sellVolumeUsd24h: row.sellVolumeUsd24h,
        netFlowUsd24h: row.netFlowUsd24h,
        tradeCount24h: row.tradeCount24h,
        chain: row.chain,
        platform: row.platform,
        rsi: row.rsi14 ?? row.rsi,
        macd: row.macdLine ?? row.macd,
        tvl: row.tvl,
        activeAddresses: row.activeAddresses,
      })),
      analysis: input.analysis.slice(0, 4_000),
      signals: input.signals.slice(0, 50).map((signal) => ({
        symbol: signal.symbol,
        action: signal.action,
        reason: signal.reason,
        price: signal.price,
        strategy: signal.strategy,
      })),
    };
  }

  private choiceAnswer(answer: DecisionAnswer | undefined) {
    if (!answer || answer.type !== 'choice') {
      throw new Error('Quality gate verdict answer is missing or invalid');
    }
    return answer;
  }

  private noulProbability(answer: DecisionAnswer | undefined): number {
    if (!answer || answer.type !== 'noul') {
      throw new Error('Quality gate Noul answer is missing or invalid');
    }
    return answer.noul;
  }

  private unavailableResult(
    mode: 'disabled' | 'shadow' | 'enforce',
    reason: string,
  ): ResearchQualityGateResult {
    return {
      mode,
      status: 'error',
      approved: mode !== 'enforce',
      reason,
    };
  }
}
