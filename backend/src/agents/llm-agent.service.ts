import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '../config/config.service';
import { UsageLedgerService } from '../usage-ledger/usage-ledger.service';
import { CrawledMarketData } from '../crawlers/types/crawler.types';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { buildChatModel } from './llm-factory.js';

@Injectable()
export class LlmAgentService {
  private readonly logger = new Logger(LlmAgentService.name);
  private llm?: ChatOpenAI;

  constructor(
    private readonly configService: ConfigService,
    private readonly usageLedger: UsageLedgerService,
  ) {
    this.llm = buildChatModel(configService);
    if (this.llm) {
      this.logger.log(
        `LLM ready (provider=${configService.llm.provider}, model=${configService.llm.model})`,
      );
    }
  }

  private promptTemplate = PromptTemplate.fromTemplate(
    `Given the following market data, provide a brief analysis and investment insight. Keep it under 300 words.
Market Data: {marketData}
`,
  );

  async generateAnalysis(marketData: CrawledMarketData[]): Promise<string> {
    if (!this.llm) {
      this.logger.warn('LLM not configured (no API key set), returning mock analysis');
      return 'This is a mock analysis since no LLM API key is set. Market shows moderate volatility with Bitcoin leading gains.';
    }

    try {
      const priceSnapshots = marketData
        .filter((row) => row.price !== undefined)
        .slice(0, 8)
        .map((row) => ({
          token: row.token,
          symbol: row.symbol,
          price: row.price,
          volume24h: row.volume24h,
          source: row.source,
        }));
      const onchainVolumes = marketData
        .filter((row) => row.buyVolumeUsd24h !== undefined)
        .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))
        .slice(0, 12)
        .map((row) => ({
          symbol: row.symbol,
          chain: row.chain,
          platform: row.platform,
          buyVolumeUsd24h: row.buyVolumeUsd24h,
          sellVolumeUsd24h: row.sellVolumeUsd24h,
          totalVolumeUsd24h: row.volume24h,
          netFlowUsd24h: row.netFlowUsd24h,
          tradeCount24h: row.tradeCount24h,
          source: row.source,
        }));
      const formattedPrompt = await this.promptTemplate.format({
        marketData: JSON.stringify({ priceSnapshots, onchainVolumes }, null, 2),
      });

      const response = await this.llm.invoke(formattedPrompt);
      const usage = response.usage_metadata;
      if (usage) {
        this.logger.log(
          `LLM token usage: input=${usage.input_tokens ?? 'unknown'} output=${usage.output_tokens ?? 'unknown'} total=${usage.total_tokens ?? 'unknown'}`,
        );
      }
      // Persist token usage to the UsageLedger for observability and daily
      // budget accounting. No pre-call reservation (deliberate simplification);
      // the reservationId here is a correlation id for the actual row only.
      if (this.usageLedger.enabled) {
        const totalTokens = usage
          ? (usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0))
          : 0;
        try {
          await this.usageLedger.recordActual(
            'llm',
            new Date(),
            randomUUID(),
            Math.max(0, Math.floor(totalTokens)),
            { unitKind: 'tokens', model: this.configService.llm.model },
          );
        } catch (error) {
          this.logger.warn(`LLM usage persistence failed: ${(error as Error).message}`);
        }
      }
      return response.content as string;
    } catch (error) {
      this.logger.error('LLM analysis generation failed', error);
      return 'Error generating analysis. Using mock fallback.';
    }
  }
}
