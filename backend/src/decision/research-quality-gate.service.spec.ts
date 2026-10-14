import type { ConfigService } from '../config/config.service';
import type { DecisionService } from './decision.service';
import { ResearchQualityGateService } from './research-quality-gate.service';

const input = {
  marketData: [
    {
      token: 'solana',
      symbol: 'SOL',
      timestamp: new Date('2026-10-12T00:00:00Z'),
      source: 'test',
      price: 150,
      rsi14: 55,
      rawData: {},
    },
  ],
  analysis: 'SOL momentum is moderately positive.',
  signals: [
    {
      token: 'solana',
      symbol: 'SOL',
      action: 'buy' as const,
      reason: 'Positive momentum',
      price: 150,
      strategy: 'test',
      status: 'pending',
      timestamp: new Date('2026-10-12T00:00:00Z'),
    },
  ],
};

function config(mode: 'disabled' | 'shadow' | 'enforce') {
  return {
    decision: {
      provider: 'jev',
      qualityGateMode: mode,
      qualityGateMinConfidence: 0.75,
    },
  } as ConfigService;
}

describe('ResearchQualityGateService', () => {
  it('passes a well-supported result in enforce mode', async () => {
    const decisions = {
      isConfigured: jest.fn().mockReturnValue(true),
      evaluate: jest.fn().mockResolvedValue({
        provider: 'jev',
        model: 'jev-1.13.0',
        latencyMs: 82,
        answers: {
          verdict: {
            type: 'choice',
            choice: 'pass',
            confidence: 0.91,
            probabilities: { pass: 0.88, review: 0.1, reject: 0.02 },
          },
          analysis_grounded: { type: 'noul', noul: 0.9 },
          signals_supported: { type: 'noul', noul: 0.86 },
        },
      }),
    } as unknown as DecisionService;
    const gate = new ResearchQualityGateService(config('enforce'), decisions);

    await expect(gate.evaluate(input)).resolves.toMatchObject({
      mode: 'enforce',
      status: 'pass',
      approved: true,
      confidence: 0.91,
    });
  });

  it('observes an uncertain result without blocking in shadow mode', async () => {
    const decisions = {
      isConfigured: jest.fn().mockReturnValue(true),
      evaluate: jest.fn().mockResolvedValue({
        provider: 'jev',
        model: 'jev-1.13.0',
        latencyMs: 70,
        answers: {
          verdict: {
            type: 'choice',
            choice: 'pass',
            confidence: 0.6,
            probabilities: { pass: 0.6, review: 0.3, reject: 0.1 },
          },
          analysis_grounded: { type: 'noul', noul: 0.7 },
          signals_supported: { type: 'noul', noul: 0.8 },
        },
      }),
    } as unknown as DecisionService;
    const gate = new ResearchQualityGateService(config('shadow'), decisions);

    await expect(gate.evaluate(input)).resolves.toMatchObject({
      mode: 'shadow',
      status: 'review',
      approved: true,
    });
  });

  it('fails closed in enforce mode when the provider is unavailable', async () => {
    const decisions = {
      isConfigured: jest.fn().mockReturnValue(false),
    } as unknown as DecisionService;
    const gate = new ResearchQualityGateService(config('enforce'), decisions);

    await expect(gate.evaluate(input)).resolves.toMatchObject({
      mode: 'enforce',
      status: 'error',
      approved: false,
    });
  });
});
