import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '../config/config.service';
import { DEFAULT_PAIRS } from '../config/tokens.js';
import { CrossChainArbStrategy } from '../strategy/strategies/cross-chain-arb.strategy.js';
import { toNativeAmount } from '../utils/amounts.js';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { RealtimeTradeRepository } from './realtime-trade.repository';

class StubConfigService {
  realtime = {
    solanaRpcUrl: 'https://api.mainnet-beta.solana.com',
    enableRealDex: false,
    jupiterApiKey: undefined,
    orcaWalletPublicKey: undefined,
    orcaPoolsByPair: undefined,
    pythHermesEndpoint: undefined,
    pythStaleMs: 15_000,
    pythMaxConfidenceBps: 75,
    pythUseMock: true,
    maxSlippageBps: 100,
    maxPositionNotionalUsd: 25_000,
    minLiquidityUsd: 1_000,
    maxOracleDeviationBps: 500,
    maxPriceImpactBps: 100,
    maxQuoteAgeMs: 5_000,
    dexQuoteTimeoutMs: 2_500,
    retries: 0,
  };
  injective = {
    enabled: false,
    network: 'testnet' as const,
    exchangeApi: 'https://api.injective.exchange',
    mcpBin: 'npx -y @injectivelabs/mcp-server',
    mnemonic: undefined,
    helixMarkets: undefined,
  };
}

class StubTradeRepository {
  trades = new Map<string, any>();
  logs: Array<{ tradeId?: string; level: string; event: string; message?: string }> = [];

  async createTrade(input: any) {
    const id = `trade_${this.trades.size + 1}`;
    const record = {
      id,
      status: 'PENDING',
      ...input,
      amountIn: input.amountIn.toString(),
      logs: [],
    };
    this.trades.set(id, record);
    return record;
  }

  async attachPlan({ tradeId, plan }: any) {
    const record = this.trades.get(tradeId);
    record.plan = plan;
    record.status = plan.status === 'ready' ? 'READY' : 'REJECTED';
    record.selectedDex = plan.selectedRoute?.quote.source;
    return record;
  }

  async markRejected({ tradeId, reason }: any) {
    const record = this.trades.get(tradeId);
    record.status = 'REJECTED';
    record.rejectionReason = reason;
    return record;
  }

  async markExecution(input: any) {
    const record = this.trades.get(input.tradeId);
    record.status = input.status;
    record.txSignature = input.txSignature;
    record.executionPrice = input.executionPrice;
    return record;
  }

  async listRecent(limit = 50) {
    return Array.from(this.trades.values()).slice(0, limit);
  }

  async findById(id: string) {
    return this.trades.get(id);
  }

  async log(tradeId: string | undefined, level: string, event: string, message?: string) {
    this.logs.push({ tradeId, level, event, message });
  }
}

class StubGateway {
  tradeEvents: any[] = [];
  priceEvents: any[] = [];
  emitTradeEvent(event: any) {
    this.tradeEvents.push(event);
  }
  emitPriceUpdate(event: any) {
    this.priceEvents.push(event);
  }
}

describe('RealtimeService', () => {
  let service: RealtimeService;
  let repo: StubTradeRepository;
  let gateway: StubGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeService,
        CrossChainArbStrategy,
        { provide: ConfigService, useClass: StubConfigService },
        { provide: RealtimeTradeRepository, useClass: StubTradeRepository },
        { provide: RealtimeGateway, useClass: StubGateway },
      ],
    }).compile();

    service = module.get<RealtimeService>(RealtimeService);
    repo = module.get(RealtimeTradeRepository) as unknown as StubTradeRepository;
    gateway = module.get(RealtimeGateway) as unknown as StubGateway;

    // Init the module manually since onModuleInit is not auto-fired without app.init()
    service.onModuleInit();

    // Swap the real RealTimeAgentCore for a deterministic mock that bypasses network IO.
    (service as any).core = {
      prepareTrade: async (intent: any) => ({
        status: 'ready',
        intent,
        pair: DEFAULT_PAIRS['SOL/USDC'],
        oraclePrice: {
          symbol: 'SOL/USDC',
          priceId: '0x',
          price: 160,
          confidence: 0.05,
          expo: -8,
          publishTime: Math.floor(Date.now() / 1000),
          receivedAt: Date.now(),
          confidenceBps: 5,
          isStale: false,
        },
        nbbo: {
          pair: DEFAULT_PAIRS['SOL/USDC'],
          bestBid: undefined,
          bestAsk: {
            source: 'mock',
            chain: 'solana',
            side: 'ask',
            pair: 'SOL/USDC',
            inputMint: 'usdc',
            outputMint: 'sol',
            inAmount: BigInt(intent.amountIn),
            outAmount: BigInt(intent.amountIn) / 160n,
            price: 160,
            feeBps: 4,
            liquidityUsd: 2_000_000,
            priceImpactBps: 2,
            latencyMs: 1,
            routeId: 'mock',
            receivedAt: Date.now(),
          },
          spreadBps: 5,
          bidDepthUsd: 0,
          askDepthUsd: 2_000_000,
          quoteCount: 1,
          failures: [],
          generatedAt: Date.now(),
        },
        selectedRoute: {
          side: 'ask',
          quote: {
            source: 'mock',
            chain: 'solana',
            side: 'ask',
            pair: 'SOL/USDC',
            inputMint: 'usdc',
            outputMint: 'sol',
            inAmount: BigInt(intent.amountIn),
            outAmount: BigInt(intent.amountIn) / 160n,
            price: 160,
            feeBps: 4,
            liquidityUsd: 2_000_000,
            priceImpactBps: 2,
            latencyMs: 1,
            routeId: 'mock',
            receivedAt: Date.now(),
          },
          reason: 'mock',
        },
        minOutAmount: BigInt(intent.amountIn) / 160n,
        createdAt: Date.now(),
      }),
    };
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('persists a trade, calls the core and emits a ready event', async () => {
    const pair = DEFAULT_PAIRS['SOL/USDC'];
    const amountIn = toNativeAmount(160, pair.quote.decimals).toString();

    const { tradeId, plan } = await service.prepareTrade({
      pair: 'SOL/USDC',
      side: 'buy',
      amountIn,
      maxSlippageBps: 100,
      user: 'someWallet',
    });

    expect(tradeId).toMatch(/^trade_/);
    expect(plan.status).toBe('ready');
    expect(repo.trades.get(tradeId).status).toBe('READY');

    const events = gateway.tradeEvents.map((event) => event.type);
    expect(events).toContain('trade.intent.received');
    expect(events).toContain('trade.plan.ready');
  });

  it('marks rejected trades and emits an error event when the core throws', async () => {
    (service as any).core = {
      prepareTrade: async () => {
        throw new Error('oracle stale');
      },
    };

    await expect(
      service.prepareTrade({
        pair: 'SOL/USDC',
        side: 'sell',
        amountIn: '1000',
        maxSlippageBps: 50,
      }),
    ).rejects.toThrow('oracle stale');

    const lastTrade = Array.from(repo.trades.values()).pop();
    expect(lastTrade.status).toBe('REJECTED');
    expect(lastTrade.rejectionReason).toBe('oracle stale');

    const events = gateway.tradeEvents.map((event) => event.type);
    expect(events).toContain('trade.error');
  });

  it('emits a confirmation event when execution status is updated', async () => {
    const pair = DEFAULT_PAIRS['SOL/USDC'];
    const amountIn = toNativeAmount(160, pair.quote.decimals).toString();

    const { tradeId } = await service.prepareTrade({
      pair: 'SOL/USDC',
      side: 'buy',
      amountIn,
      maxSlippageBps: 100,
    });

    await service.confirmExecution({
      tradeId,
      status: 'CONFIRMED',
      txSignature: 'tx_abc',
      executionPrice: 160,
    });

    expect(repo.trades.get(tradeId).status).toBe('CONFIRMED');
    expect(repo.trades.get(tradeId).txSignature).toBe('tx_abc');

    const eventTypes = gateway.tradeEvents.map((event) => event.type);
    expect(eventTypes).toContain('trade.confirmed');
  });
});
