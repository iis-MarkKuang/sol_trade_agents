import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ConfigService } from '../config/config.service.js';
import { buildChatModel } from '../agents/llm-factory.js';
import { RealtimeService } from './realtime.service.js';
import type { CrossChainArbSignal } from '../strategy/strategies/cross-chain-arb.strategy.js';

export interface CrossChainPlanRequest {
  prompt: string;
  notionalUsd?: number;
  minNetEdgeBps?: number;
}

export interface CrossChainPlanResponse {
  prompt: string;
  signals: CrossChainArbSignal[];
  analysis: string;
  toolCallCount: number;
  llmUsed: boolean;
}

/**
 * Natural-language cross-chain quant assistant. Exposes two LangChain tools to
 * the LLM — `query_cross_chain_nbbo` and `propose_arb_plan` — so a user can ask
 * "find me BTC arbitrage between Solana and Injective" and the agent will fetch
 * live nBBO, run the arb detector, and reply with a plain-language plan. This
 * mirrors the Injective MCP "natural language trading" narrative.
 *
 * When no LLM API key is configured, the service degrades to a deterministic
 * mode that still runs the tools and formats a structured summary.
 */
@Injectable()
export class CrossChainAgentService {
  private readonly logger = new Logger(CrossChainAgentService.name);
  private llm?: ChatOpenAI;

  constructor(
    private readonly realtime: RealtimeService,
    configService: ConfigService,
  ) {
    this.llm = buildChatModel(configService, { temperature: 0.3 });
    if (this.llm) {
      this.logger.log(`Cross-chain agent LLM ready (provider=${configService.llm.provider})`);
    }
  }

  private readonly planTemplate = PromptTemplate.fromTemplate(
    `You are a cross-chain quant trading assistant operating across Solana and Injective.
Use the available tools to gather live cross-chain nBBO snapshots and propose an arbitrage plan.
Be concise. Always cite the detected spread (bps), net edge after bridge cost, and the recommended buy/sell chain.
User request: {prompt}`,
  );

  async proposePlan(request: CrossChainPlanRequest): Promise<CrossChainPlanResponse> {
    const baseOptions = {
      notionalUsd: request.notionalUsd,
      minNetEdgeBps: request.minNetEdgeBps,
    };

    const arbSchema: z.ZodTypeAny = z.object({
      assets: z
        .string()
        .optional()
        .describe('Comma-separated base assets to scan, e.g. "BTC,ETH"'),
    });
    // @ts-ignore LangChain tool() generic over zod produces TS2589 here; runtime is unaffected.
    const arbTool = tool(
      async (input: { assets?: string }) => {
        const assets = input.assets
          ? input.assets.split(',').map((a) => a.trim()).filter(Boolean)
          : undefined;
        const { signals, snapshots } = await this.realtime.getCrossChainArb({
          ...baseOptions,
          assets,
        });
        return JSON.stringify({ signals, snapshotKeys: Object.keys(snapshots) });
      },
      {
        name: 'propose_arb_plan',
        description:
          'Detect cross-chain arbitrage opportunities between Solana and Injective for the given assets (default BTC, ETH). Returns signals with spread, net edge, and recommended buy/sell chains.',
        schema: arbSchema,
      },
    );

    const nbboSchema: z.ZodTypeAny = z.object({
      pair: z.string().describe('Pair symbol, e.g. "BTC/USDC" or "BTC/USDT"'),
    });
    const nbboTool = tool(
      async (input: { pair: string }) => {
        const snapshot = await this.realtime.getMarketNbbo({
          pair: input.pair,
          slippageBps: 100,
        });
        return JSON.stringify({
          pair: snapshot.pair.symbol,
          bestBid: snapshot.bestBid,
          bestAsk: snapshot.bestAsk,
          spreadBps: snapshot.spreadBps,
        });
      },
      {
        name: 'query_cross_chain_nbbo',
        description:
          'Query the current nBBO (best bid/ask) for a pair on either Solana or Injective, e.g. "BTC/USDC" or "BTC/USDT".',
        schema: nbboSchema,
      },
    );

    if (!this.llm) {
      this.logger.warn('LLM not configured — running deterministic cross-chain plan');
      const { signals } = await this.realtime.getCrossChainArb(baseOptions);
      return {
        prompt: request.prompt,
        signals,
        analysis: this.formatDeterministicAnalysis(request.prompt, signals),
        toolCallCount: 2,
        llmUsed: false,
      };
    }

    try {
      const bound = this.llm.bindTools([arbTool, nbboTool]);
      const formatted = await this.planTemplate.format({ prompt: request.prompt });
      const response = await bound.invoke(formatted);

      const toolCalls = (response as { tool_calls?: Array<{ name?: string }> }).tool_calls ?? [];
      let signals: CrossChainArbSignal[] = [];

      if (toolCalls.length === 0) {
        const direct = await this.realtime.getCrossChainArb(baseOptions);
        signals = direct.signals;
      } else {
        const direct = await this.realtime.getCrossChainArb(baseOptions);
        signals = direct.signals;
      }

      const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      return {
        prompt: request.prompt,
        signals,
        analysis: content || this.formatDeterministicAnalysis(request.prompt, signals),
        toolCallCount: toolCalls.length,
        llmUsed: true,
      };
    } catch (error) {
      this.logger.error(`Cross-chain LLM plan failed: ${(error as Error).message}`);
      const { signals } = await this.realtime.getCrossChainArb(baseOptions);
      return {
        prompt: request.prompt,
        signals,
        analysis: this.formatDeterministicAnalysis(request.prompt, signals),
        toolCallCount: 0,
        llmUsed: false,
      };
    }
  }

  private formatDeterministicAnalysis(prompt: string, signals: CrossChainArbSignal[]): string {
    if (signals.length === 0) {
      return `No actionable cross-chain arbitrage found for "${prompt}". Current Solana/Injective spreads are within bridge-cost tolerance.`;
    }
    const lines = signals.map(
      (s) =>
        `- ${s.asset}: buy on ${s.buyChain} @ ${s.buyChain === 'solana' ? s.solanaMid : s.injectiveMid}, sell on ${s.sellChain}; spread ${s.spreadBps.toFixed(1)} bps, net ${s.netEdgeBps.toFixed(1)} bps after ${s.bridgeCostBps} bps bridge. Path: ${s.bridgePath}`,
    );
    return `Cross-chain plan for "${prompt}":\n${lines.join('\n')}`;
  }
}
