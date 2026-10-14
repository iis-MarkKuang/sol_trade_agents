import { OfflineAgentService } from './offline-agent.service';

const marketRow = {
  token: 'solana',
  symbol: 'SOL',
  timestamp: new Date('2026-10-14T00:00:00Z'),
  source: 'fixture',
  price: 150,
  rsi14: 65,
  rawData: {},
};

const signal = {
  token: 'solana',
  symbol: 'SOL',
  action: 'buy' as const,
  confidence: 0.82,
  reason: 'Positive fixture momentum',
  price: 150,
  strategy: 'fixture-momentum',
  status: 'pending',
  timestamp: new Date('2026-10-14T00:00:01Z'),
};

function createWorkflow(qualityGate: {
  mode: 'shadow' | 'enforce';
  status: 'pass' | 'reject';
  approved: boolean;
}) {
  const coinmarketcap = { run: jest.fn().mockResolvedValue([marketRow]) };
  const tradingview = { run: jest.fn().mockResolvedValue([]) };
  const dune = { run: jest.fn().mockResolvedValue([]) };
  const cleaner = { cleanData: jest.fn((rows) => rows) };
  const normalizer = { normalizeData: jest.fn((rows) => rows) };
  const llm = {
    generateAnalysis: jest.fn().mockResolvedValue('SOL has positive fixture momentum.'),
  };
  const strategy = { runAllStrategies: jest.fn().mockResolvedValue([signal]) };
  const gate = { evaluate: jest.fn().mockResolvedValue(qualityGate) };
  const prisma = {
    analysisResult: {
      create: jest.fn().mockResolvedValue({ id: 'analysis-fixture' }),
      findMany: jest.fn(),
    },
    tradeSignal: {
      create: jest.fn().mockResolvedValue({ id: 'signal-fixture' }),
      findMany: jest.fn(),
    },
    marketData: { findMany: jest.fn() },
  };
  const gateway = { emit: jest.fn() };

  const service = new OfflineAgentService(
    coinmarketcap as never,
    tradingview as never,
    dune as never,
    cleaner as never,
    normalizer as never,
    llm as never,
    strategy as never,
    gate as never,
    prisma as never,
    gateway as never,
  );

  return {
    service,
    coinmarketcap,
    cleaner,
    normalizer,
    llm,
    strategy,
    gate,
    prisma,
    gateway,
  };
}

describe('Offline agentic workflow simulation', () => {
  it('gathers, analyzes, decides, and persists an approved signal', async () => {
    const workflow = createWorkflow({
      mode: 'shadow',
      status: 'pass',
      approved: true,
    });

    const summary = await workflow.service.runPipeline();

    expect(workflow.coinmarketcap.run).toHaveBeenCalled();
    expect(workflow.cleaner.cleanData).toHaveBeenCalledWith([marketRow]);
    expect(workflow.normalizer.normalizeData).toHaveBeenCalledWith([marketRow]);
    expect(workflow.llm.generateAnalysis).toHaveBeenCalledWith([marketRow]);
    expect(workflow.strategy.runAllStrategies).toHaveBeenCalledWith([marketRow]);
    expect(workflow.gate.evaluate).toHaveBeenCalledWith({
      marketData: [marketRow],
      analysis: 'SOL has positive fixture momentum.',
      signals: [signal],
    });
    expect(workflow.prisma.analysisResult.create).toHaveBeenCalled();
    expect(workflow.prisma.tradeSignal.create).toHaveBeenCalled();
    expect(summary).toMatchObject({
      normalized: 1,
      signalsGenerated: 1,
      signalsPersisted: 1,
      qualityGate: { status: 'pass', approved: true },
    });
  });

  it('keeps rejected enforce-mode signals out of persistence', async () => {
    const workflow = createWorkflow({
      mode: 'enforce',
      status: 'reject',
      approved: false,
    });

    const summary = await workflow.service.runPipeline();

    expect(workflow.prisma.analysisResult.create).toHaveBeenCalled();
    expect(workflow.prisma.tradeSignal.create).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      signalsGenerated: 1,
      signalsPersisted: 0,
      qualityGate: { mode: 'enforce', status: 'reject', approved: false },
    });
  });
});
