import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '../config/config.service';
import { CrossChainArbStrategy } from '../strategy/strategies/cross-chain-arb.strategy.js';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { RealtimeTradeRepository } from './realtime-trade.repository';

/**
 * End-to-end Monad integration test (zero paid keys).
 * Boots RealtimeService with ENABLE_MONAD=true MONAD_DEX_MODE=mock and verifies:
 *  - the Monad adapter + mock executor are wired
 *  - executeMonadTrade persists a trade + emits lifecycle events for a monad plan
 *  - crossChainArb emits a solana<->monad signal when mids diverge (real mock nBBO path)
 *  - ENABLE_MONAD=false blocks Monad execution
 */
class StubTradeRepository {
  trades = new Map<string, any>();
  logs: Array<{ tradeId?: string; level: string; event: string; message?: string }> = [];

  async createTrade(input: any) {
    const id = `trade_${this.trades.size + 1}`;
    const record = { id, status: 'PENDING', ...input, amountIn: input.amountIn.toString(), logs: [] };
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

function makeMonadConfigService(enabled: boolean) {
  return {
    realtime: {
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
    },
    injective: { enabled: false, network: 'testnet' as const, exchangeApi: '', mcpBin: '', mnemonic: undefined, helixMarkets: undefined },
    monad: {
      enabled,
      network: 'mainnet' as const,
      rpcUrl: 'https://rpc.monad.xyz',
      privateKey: undefined,
      dexMode: 'mock' as const,
      zeroxApiKey: undefined,
      oneinchApiKey: undefined,
      mockPremiumBps: 30,
    },
  };
}

function makeMonadPlan() {
  return {
    status: 'ready' as const,
    intent: { pair: 'WBTC/USDC', side: 'buy' as const, amountIn: 1_000_000n, maxSlippageBps: 100 },
    pair: { symbol: 'WBTC/USDC', chain: 'monad', base: { symbol: 'BTC', address: '0xWBTC', decimals: 8 }, quote: { symbol: 'USDC', address: '0xUSDC', decimals: 6 } },
    oraclePrice: { symbol: 'WBTC/USDC', priceId: '0x', price: 64000, confidence: 0.05, expo: -8, publishTime: Math.floor(Date.now() / 1000), receivedAt: Date.now(), confidenceBps: 5, isStale: false },
    nbbo: { pair: { symbol: 'WBTC/USDC' }, bestBid: undefined, bestAsk: undefined, spreadBps: 0, bidDepthUsd: 0, askDepthUsd: 0, quoteCount: 1, failures: [], generatedAt: Date.now() },
    selectedRoute: {
      side: 'ask' as const,
      quote: {
        source: 'monad_dex',
        chain: 'monad',
        side: 'ask' as const,
        pair: 'WBTC/USDC',
        inputMint: '0xUSDC',
        outputMint: '0xWBTC',
        inAmount: 1_000_000n,
        outAmount: 15_625n,
        price: 64000,
        feeBps: 10,
        liquidityUsd: 1_500_000,
        priceImpactBps: 0,
        latencyMs: 1,
        routeId: 'monad_dex:mock',
        receivedAt: Date.now(),
        raw: { dex: '0x', mock: true },
      },
      reason: 'best ask',
    },
    minOutAmount: 15_500n,
    monadExecutionPlan: {
      chainId: 143,
      dex: '0x' as const,
      tokenIn: '0xUSDC',
      tokenOut: '0xWBTC',
      side: 'buy' as const,
      amountIn: '1000000',
      minAmountOut: '0',
      to: '0xRECIPIENT',
      deadline: Math.floor(Date.now() / 1000) + 600,
      notionalUsd: 1000,
      reason: 'Monad 0x WBTC/USDC buy via viem',
    },
    createdAt: Date.now(),
  };
}

async function bootService(monadEnabled: boolean) {
  const stubConfig = makeMonadConfigService(monadEnabled);
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      RealtimeService,
      CrossChainArbStrategy,
      { provide: ConfigService, useValue: stubConfig },
      { provide: RealtimeTradeRepository, useClass: StubTradeRepository },
      { provide: RealtimeGateway, useClass: StubGateway },
    ],
  }).compile();
  const service = module.get<RealtimeService>(RealtimeService);
  const repo = module.get(RealtimeTradeRepository) as unknown as StubTradeRepository;
  const gateway = module.get(RealtimeGateway) as unknown as StubGateway;
  await service.onModuleInit();
  return { service, repo, gateway };
}

describe('Monad integration (e2e, zero keys)', () => {
  it('wires the Monad adapter + mock executor when ENABLE_MONAD=true', async () => {
    const { service } = await bootService(true);
    expect(service.getPolicy().allowedDexes).toContain('monad_dex');
    const executor = (service as any).monadExecutor;
    expect(executor).toBeDefined();
    expect(await executor.isAvailable()).toBe(true);
  });

  it('executeMonadTrade persists the trade + emits a submitted event for a monad plan', async () => {
    const { service, repo, gateway } = await bootService(true);
    const plan = makeMonadPlan();
    const trade = await repo.createTrade({ pair: 'WBTC/USDC', side: 'buy', amountIn: 1000000n, maxSlippageBps: 100 });
    await repo.attachPlan({ tradeId: trade.id, plan });

    const result = await service.executeMonadTrade({ tradeId: trade.id });

    expect(result.status).toBe('simulated');
    expect(result.txHash).toMatch(/^mock_monad_/);
    const persisted = repo.trades.get(trade.id);
    expect(persisted.status).toBe('SUBMITTED');
    const events = gateway.tradeEvents.map((e) => e.type);
    expect(events).toContain('trade.submitted');
  });

  it('crossChainArb emits a solana<->monad signal when mids diverge (real mock nBBO)', async () => {
    const { service } = await bootService(true);
    // The mock nBBO applies a 30 bps Monad premium, so solana BTC mid=64000 and
    // monad WBTC mid=64000*1.003. With bridgeCostBps=0 the net edge is ~30 bps.
    const { signals } = await service.getCrossChainArb({
      chains: ['solana', 'monad'],
      bridgeCostBps: 0,
      minNetEdgeBps: 1,
      assets: ['BTC'],
    });
    expect(signals.length).toBeGreaterThanOrEqual(1);
    const s = signals.find((sig) => sig.buyChain === 'solana' && sig.sellChain === 'monad');
    expect(s).toBeDefined();
    expect(s!.netEdgeBps).toBeGreaterThan(0);
  });

  it('ENABLE_MONAD=false blocks Monad execution', async () => {
    const { service } = await bootService(false);
    expect(service.getPolicy().allowedDexes).not.toContain('monad_dex');
    await expect(service.executeMonadTrade({ tradeId: 'nope' })).rejects.toThrow(
      /Monad execution is not enabled/,
    );
  });
});
