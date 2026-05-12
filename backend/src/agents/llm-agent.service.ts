import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { CrawledMarketData } from '../crawlers/types/crawler.types';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';

@Injectable()
export class LlmAgentService {
  private readonly logger = new Logger(LlmAgentService.name);
  private llm?: ChatOpenAI;

  constructor(private configService: ConfigService) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.llm = new ChatOpenAI({
        openAIApiKey: apiKey,
        temperature: 0.7,
        modelName: 'gpt-4o-mini',
      });
    }
  }

  private promptTemplate = PromptTemplate.fromTemplate(
    `Given the following market data, provide a brief analysis and investment insight. Keep it under 300 words.
Market Data: {marketData}
`
  );

  async generateAnalysis(marketData: CrawledMarketData[]): Promise<string> {
    if (!this.llm) {
      this.logger.warn('LLM not configured (no API key set), returning mock analysis');
      return 'This is a mock analysis since no LLM API key is set. Market shows moderate volatility with Bitcoin leading gains.';
    }

    try {
      const formattedPrompt = await this.promptTemplate.format({
        marketData: JSON.stringify(
          marketData.slice(0, 5).map((d) => ({
            token: d.token,
            symbol: d.symbol,
            price: d.price,
            source: d.source,
          })),
          null,
          2
        ),
      });

      const response = await this.llm.invoke(formattedPrompt);
      return response.content as string;
    } catch (error) {
      this.logger.error('LLM analysis generation failed', error);
      return 'Error generating analysis. Using mock fallback.';
    }
  }
}
