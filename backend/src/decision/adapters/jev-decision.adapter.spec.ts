import type { ConfigService } from '../../config/config.service';
import { JevDecisionAdapter } from './jev-decision.adapter';

function makeUsageLedgerMock() {
  return {
    enabled: false,
    reserve: jest.fn(),
    recordActual: jest.fn(),
    recordFailed: jest.fn(),
    recordCacheHit: jest.fn(),
    checkBudget: jest.fn(),
    rebuildCounters: jest.fn(),
  };
}

const baseDecisionConfig = {
  jevApiKey: 'typesafe-key',
  jevApiBaseUrl: 'https://api.typesafe.ai',
  jevModel: 'jev-1.13.0',
  jevTimeoutMs: 1_500,
};

describe('JevDecisionAdapter', () => {
  let usageLedger: ReturnType<typeof makeUsageLedgerMock>;

  beforeEach(() => {
    usageLedger = makeUsageLedgerMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls the System One endpoint and returns typed answers', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: {
          verdict: {
            type: 'choice',
            choice: 'pass',
            confidence: 0.9,
            probabilities: { pass: 0.9, reject: 0.1 },
          },
        },
        usage: { input_tokens: 120, output_tokens: 0 },
      }),
    } as Response);
    const config = { decision: baseDecisionConfig } as ConfigService;
    const adapter = new JevDecisionAdapter(config, usageLedger as any);

    const result = await adapter.evaluate({
      state: { analysis: 'grounded' },
      questions: {
        verdict: {
          type: 'choice',
          instructions: 'Evaluate quality.',
          criteria: { pass: 'Supported', reject: 'Unsupported' },
        },
      },
    });

    expect(result.answers.verdict).toMatchObject({
      type: 'choice',
      choice: 'pass',
      confidence: 0.9,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.typesafe.ai/v1/systemone',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer typesafe-key',
        }),
      }),
    );
    // Ledger disabled: no usage recording.
    expect(usageLedger.recordActual).not.toHaveBeenCalled();
  });

  it('does not report configured without a TypeSafe key', () => {
    const config = { decision: { ...baseDecisionConfig, jevApiKey: undefined } } as ConfigService;
    expect(new JevDecisionAdapter(config, usageLedger as any).isConfigured()).toBe(false);
  });

  describe('with UsageLedger enabled', () => {
    beforeEach(() => {
      usageLedger.enabled = true;
    });

    it('persists token usage via recordActual on success', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'jev-1.13.0',
          answers: {
            verdict: { type: 'choice', choice: 'pass', confidence: 0.9, probabilities: { pass: 0.9 } },
          },
          usage: { input_tokens: 120, output_tokens: 30 },
        }),
      } as Response);
      usageLedger.recordActual.mockResolvedValue(undefined);
      const config = { decision: baseDecisionConfig } as ConfigService;
      const adapter = new JevDecisionAdapter(config, usageLedger as any);

      await adapter.evaluate({
        state: { analysis: 'grounded' },
        questions: {
          verdict: { type: 'choice', instructions: 'x', criteria: { pass: 'p', reject: 'r' } },
        },
      });

      expect(usageLedger.recordActual).toHaveBeenCalledWith(
        'jev',
        expect.any(Date),
        expect.any(String),
        150,
        expect.objectContaining({ unitKind: 'tokens', model: 'jev-1.13.0' }),
      );
      expect(usageLedger.recordFailed).not.toHaveBeenCalled();
    });

    it('records failed and rethrows when the JEV call fails', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 451,
        text: async () => 'blocked',
      } as Response);
      usageLedger.recordFailed.mockResolvedValue(undefined);
      const config = { decision: baseDecisionConfig } as ConfigService;
      const adapter = new JevDecisionAdapter(config, usageLedger as any);

      await expect(
        adapter.evaluate({
          state: { analysis: 'grounded' },
          questions: {
            verdict: { type: 'choice', instructions: 'x', criteria: { pass: 'p', reject: 'r' } },
          },
        }),
      ).rejects.toThrow(/JEV request failed/);

      expect(usageLedger.recordFailed).toHaveBeenCalledWith(
        'jev',
        expect.any(Date),
        expect.any(String),
        expect.objectContaining({ unitKind: 'tokens', model: 'jev-1.13.0' }),
      );
      expect(usageLedger.recordActual).not.toHaveBeenCalled();
    });

    it('records zero tokens when usage is missing', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'jev-1.13.0',
          answers: {
            verdict: { type: 'choice', choice: 'pass', confidence: 0.9, probabilities: { pass: 0.9 } },
          },
        }),
      } as Response);
      usageLedger.recordActual.mockResolvedValue(undefined);
      const config = { decision: baseDecisionConfig } as ConfigService;
      const adapter = new JevDecisionAdapter(config, usageLedger as any);

      await adapter.evaluate({
        state: { analysis: 'grounded' },
        questions: {
          verdict: { type: 'choice', instructions: 'x', criteria: { pass: 'p', reject: 'r' } },
        },
      });

      expect(usageLedger.recordActual).toHaveBeenCalledWith(
        'jev',
        expect.any(Date),
        expect.any(String),
        0,
        expect.objectContaining({ unitKind: 'tokens', model: 'jev-1.13.0' }),
      );
    });
  });
});
