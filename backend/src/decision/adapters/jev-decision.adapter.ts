import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { ConfigService } from '../../config/config.service.js';
import { UsageLedgerService } from '../../usage-ledger/usage-ledger.service.js';
import type {
  DecisionAnswer,
  DecisionAdapter,
  DecisionRequest,
  DecisionResult,
} from '../decision.types.js';

const ChoiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.number()),
});

const ScoreAnswerSchema = z.object({
  type: z.literal('score'),
  score: z.number(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.number()),
});

const NoulAnswerSchema = z.object({
  type: z.literal('noul'),
  noul: z.number().min(0).max(1),
});

const JevResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.union([ChoiceAnswerSchema, ScoreAnswerSchema, NoulAnswerSchema])),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});

@Injectable()
export class JevDecisionAdapter implements DecisionAdapter {
  readonly name = 'jev' as const;
  private readonly logger = new Logger(JevDecisionAdapter.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usageLedger: UsageLedgerService,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.configService.decision.jevApiKey);
  }

  async evaluate(request: DecisionRequest): Promise<DecisionResult> {
    const config = this.configService.decision;
    if (!config.jevApiKey) {
      throw new Error('TYPESAFE_API_KEY is not configured');
    }

    const startedAt = performance.now();
    const today = new Date();
    const reservationId = randomUUID();

    try {
      const response = await fetch(`${config.jevApiBaseUrl}/v1/systemone`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.jevApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.jevModel,
          state: request.state,
          questions: request.questions,
        }),
        signal: AbortSignal.timeout(config.jevTimeoutMs),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`JEV request failed (${response.status}): ${body.slice(0, 240)}`);
      }

      const parsed = JevResponseSchema.parse(await response.json());
      const result: DecisionResult = {
        provider: this.name,
        model: parsed.model,
        answers: parsed.answers as Record<string, DecisionAnswer>,
        latencyMs: Math.round(performance.now() - startedAt),
        usage: parsed.usage
          ? {
              inputTokens: parsed.usage.input_tokens,
              outputTokens: parsed.usage.output_tokens,
            }
          : undefined,
      };

      // Persist JEV token usage for observability and daily budget accounting.
      // No pre-call reservation (mirrors the LLM simplification); the
      // reservationId is a correlation id for the actual/failed row.
      if (this.usageLedger.enabled) {
        const totalTokens = parsed.usage
          ? (parsed.usage.input_tokens ?? 0) + (parsed.usage.output_tokens ?? 0)
          : 0;
        try {
          await this.usageLedger.recordActual('jev', today, reservationId, Math.max(0, Math.floor(totalTokens)), {
            unitKind: 'tokens',
            model: parsed.model,
          });
        } catch (error) {
          this.logger.warn(`JEV usage persistence failed: ${(error as Error).message}`);
        }
      }

      return result;
    } catch (error) {
      if (this.usageLedger.enabled) {
        try {
          await this.usageLedger.recordFailed('jev', today, reservationId, {
            unitKind: 'tokens',
            model: config.jevModel,
          });
        } catch (recordError) {
          this.logger.warn(`JEV failed-usage persistence failed: ${(recordError as Error).message}`);
        }
      }
      throw error;
    }
  }
}
