import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Connection } from '@solana/web3.js';
import { ConfigService } from '../config/config.service';
import {
  ALL_PAIRS,
  INJECTIVE_HELIX_MARKETS,
  getTokenPair,
  normalizePairSymbol,
  pairSymbolForChain,
} from '../config/tokens.js';
import { RealTimeAgentCore } from '../agent/realtime-agent-core.js';
import type { DexAdapter } from '../dex/adapter.js';
import { DexOrderBookAggregator } from '../dex/aggregator.js';
import { InjectiveHelixAdapter, type InjectiveHelixMarket } from '../dex/injective-helix-adapter.js';
import { JupiterQuoteAdapter } from '../dex/jupiter-adapter.js';
import { MockDexAdapter } from '../dex/mock-adapter.js';
import { OracleMockAdapter } from '../dex/oracle-mock-adapter.js';
import { OrcaWhirlpoolOrderBookAdapter } from '../dex/orca-adapter.js';
import { RaydiumOrderBookAdapter } from '../dex/raydium-adapter.js';
import { NbboEngine } from '../nbbo/engine.js';
import { PythPriceFeedService, MockPythPriceFeedService, type PriceFeedSubscriber, type PriceFeedSubscription } from '../oracle/pyth-price-feed.js';
import { RiskEngine } from '../risk/risk-engine.js';
import { CrossChainArbStrategy, type CrossChainArbOptions, type CrossChainArbSignal } from '../strategy/strategies/cross-chain-arb.strategy.js';
import { JupiterTransactionBuilder } from '../transactions/jupiter-transaction-builder.js';
import {
  InjectiveMcpClient,
  MockInjectiveTradeExecutor,
  type InjectiveTradeExecutor,
  type InjectiveTradeResult,
} from '../transactions/injective-mcp-client.js';
import type {
  AggregatedOrderBook,
  DexQuoteRequest,
  InjectiveExecutionPlan,
  NbboSnapshot,
  PriceUpdate,
  RiskPolicy,
  TokenPair,
  TradeExecutionPlan,
  TradeIntent,
} from '../types.js';
import { applyBps, toNativeAmount } from '../utils/amounts.js';
import { withTimeout } from '../utils/async.js';
import {
  PrepareTradeDto,
  PrepareTradeDtoSchema,
} from './dto/prepare-trade.dto';
import {
  RealtimeGateway,
  type TradeEvent,
} from './realtime.gateway';
import {
  RealtimeTradeRepository,
  type RealtimeLogLevel,
} from './realtime-trade.repository';

export interface MarketNbboQuery {
  pair: string;
  mockMid?: number;
  bidBaseAmount?: number | string;
  askQuoteAmount?: number | string;
  slippageBps?: number;
}

/** Last-resort reference USD prices used when the live Pyth feed is unreachable. */
const REFERENCE_USD: Record<string, number> = {
  BTC: 64_000,
  ETH: 3_500,
  INJ: 25,
  SOL: 190,
};

/** Deterministic Injective premium (bps) so the cross-chain nBBO + arb scan stay meaningful in mock mode. */
const INJECTIVE_MOCK_OFFSET_BPS = 60;

function referencePriceFor(pair: TokenPair): number {
  return REFERENCE_USD[pair.base.symbol] ?? 100;
}

function buildMockPythPrices(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of Object.values(ALL_PAIRS)) {
    out[pair.symbol] = referencePriceFor(pair);
  }
  return out;
}

/**
 * Wraps the Pyth price feed so that a transient Hermes REST failure (the
 * `fetch failed` that crashes prepareTrade) falls back to the in-memory
 * priceCache warmed by the SSE subscription. The cache is keyed by symbol and
 * refreshed on every price tick, so the fallback stays fresh.
 */
class CachedFallbackPriceFeed implements PriceFeedSubscriber {
  constructor(
    private readonly inner: PriceFeedSubscriber,
    private readonly cache: Map<string, PriceUpdate>,
  ) {}

  async getLatest(pairs: TokenPair[]): Promise<Map<string, PriceUpdate>> {
    try {
      return await this.inner.getLatest(pairs);
    } catch (error) {
      const out = new Map<string, PriceUpdate>();
      for (const pair of pairs) {
        const cached = this.cache.get(pair.symbol);
        if (!cached) {
          throw error;
        }
        out.set(pair.symbol, cached);
      }
      return out;
    }
  }

  subscribe(
    pairs: TokenPair[],
    onUpdate: (update: PriceUpdate) => void,
  ): Promise<PriceFeedSubscription> {
    return this.inner.subscribe(pairs, onUpdate);
  }
}

@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);

  private core!: RealTimeAgentCore;
  private aggregator!: DexOrderBookAggregator;
  private nbbo = new NbboEngine();
  private priceFeed!: PriceFeedSubscriber;
  private priceSubscription?: PriceFeedSubscription;
  private policy!: RiskPolicy;
  private injectiveExecutor?: InjectiveTradeExecutor;
  private readonly disposables: Array<() => unknown> = [];
  private readonly priceCache = new Map<string, PriceUpdate>();

  constructor(
    private readonly configService: ConfigService,
    private readonly tradeRepo: RealtimeTradeRepository,
    private readonly gateway: RealtimeGateway,
    private readonly arbStrategy: CrossChainArbStrategy,
  ) {}

  async onModuleInit(): Promise<void> {
    const cfg = this.configService.realtime;
    const injCfg = this.configService.injective;
    const allowedDexes: RiskPolicy['allowedDexes'] = cfg.enableRealDex
      ? ['jupiter', 'raydium', 'orca', 'mock']
      : ['mock'];
    if (injCfg.enabled) {
      allowedDexes.push('injective_helix');
    }

    this.policy = {
      allowedPairs: Object.keys(ALL_PAIRS),
      allowedDexes,
      maxSlippageBps: cfg.maxSlippageBps,
      maxPositionNotionalUsd: cfg.maxPositionNotionalUsd,
      minLiquidityUsd: cfg.minLiquidityUsd,
      maxOracleDeviationBps: cfg.maxOracleDeviationBps,
      maxPriceImpactBps: cfg.maxPriceImpactBps,
      maxQuoteAgeMs: cfg.maxQuoteAgeMs,
    };

    this.priceFeed = new PythPriceFeedService({
      endpoint: cfg.pythHermesEndpoint,
      staleMs: cfg.pythStaleMs,
      maxConfidenceBps: cfg.pythMaxConfidenceBps,
    });

    // PYTH_USE_MOCK forces a deterministic mock price feed (clean reference
    // prices). Otherwise probe the live Pyth Hermes endpoint; some networks
    // block Node's TLS handshake to hermes.pyth.network (curl works, Node fetch
    // doesn't), so fall back to mock to keep prepareTrade from crashing on
    // `fetch failed`.
    if (cfg.pythUseMock) {
      this.logger.log('PYTH_USE_MOCK=true — using mock price feed (deterministic reference prices).');
      this.priceFeed = new MockPythPriceFeedService(buildMockPythPrices());
    } else {
      try {
        await withTimeout(
          this.priceFeed.getLatest(Object.values(ALL_PAIRS)),
          4_000,
          'pyth probe',
        );
      } catch (error) {
        this.logger.warn(
          `Pyth Hermes unreachable (${(error as Error).message}); using mock price feed (deterministic reference prices).`,
        );
        this.priceFeed = new MockPythPriceFeedService(buildMockPythPrices());
      }
    }

    const adapters: DexAdapter[] = cfg.enableRealDex
      ? this.buildLiveAdapters()
      : [
          new OracleMockAdapter({
            source: 'mock',
            getMidPrice: (symbol) => this.priceCache.get(symbol)?.price,
            fallbackMidPrice: 160,
            bidSpreadBps: 8,
            askSpreadBps: 10,
            liquidityUsd: 5_000_000,
          }),
        ];

    if (injCfg.enabled) {
      adapters.push(this.buildInjectiveAdapter());
      this.injectiveExecutor = this.buildInjectiveExecutor();
    }

    this.aggregator = new DexOrderBookAggregator(adapters, {
      quoteTimeoutMs: cfg.dexQuoteTimeoutMs,
    });

    this.core = new RealTimeAgentCore({
      priceFeed: new CachedFallbackPriceFeed(this.priceFeed, this.priceCache),
      aggregator: this.aggregator,
      nbbo: this.nbbo,
      risk: new RiskEngine(),
      policy: this.policy,
      tokenPairs: ALL_PAIRS,
      txBuilder: cfg.enableRealDex
        ? new JupiterTransactionBuilder({ apiKey: cfg.jupiterApiKey })
        : undefined,
      injectiveExecutor: this.injectiveExecutor,
      retries: cfg.retries,
    });

    this.subscribePythBroadcast();
    this.logger.log(
      `Realtime agent initialised (realDex=${cfg.enableRealDex}, injective=${injCfg.enabled}, pairs=${Object.keys(
        ALL_PAIRS,
      ).join(',')})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    try {
      this.priceSubscription?.close();
    } catch (error) {
      this.logger.warn(`Failed to close Pyth subscription: ${(error as Error).message}`);
    }
    for (const dispose of this.disposables) {
      try {
        await dispose();
      } catch (error) {
        this.logger.warn(`Disposable cleanup failed: ${(error as Error).message}`);
      }
    }
  }

  getPolicy(): RiskPolicy {
    return this.policy;
  }

  /**
   * Drives the end-to-end nBBO workflow:
   *  1. Persist intent
   *  2. Emit trade.intent.received to subscribers
   *  3. Call RealTimeAgentCore.prepareTrade (Pyth + DEX + nBBO + risk)
   *  4. Persist plan/rejection + emit lifecycle events
   */
  async prepareTrade(input: unknown): Promise<{
    tradeId: string;
    plan: TradeExecutionPlan;
  }> {
    const dto = PrepareTradeDtoSchema.parse(input) as PrepareTradeDto;
    const cfg = this.configService.realtime;
    const maxSlippageBps = dto.maxSlippageBps ?? cfg.maxSlippageBps;
    // amountIn may arrive as native units (frontend) or a decimal string (MCP tool).
    // Native integer strings convert directly; decimals fall back to decimal->native
    // using the input token's decimals (sell spends base, buy spends quote).
    const pair = getTokenPair(dto.pair);
    const inputDecimals = dto.side === 'sell' ? pair.base.decimals : pair.quote.decimals;
    let amountInNative: bigint;
    try {
      amountInNative = BigInt(String(dto.amountIn));
    } catch {
      amountInNative = toNativeAmount(String(dto.amountIn), inputDecimals);
    }
    const tradeRecord = await this.tradeRepo.createTrade({
      intentId: dto.id,
      userPubkey: dto.user,
      pair: dto.pair,
      side: dto.side,
      amountIn: amountInNative,
      maxSlippageBps,
    });

    const baseEvent = {
      tradeId: tradeRecord.id,
      intentId: dto.id,
      userPubkey: dto.user,
      pair: dto.pair,
      side: dto.side,
    } as const;

    this.emit(
      {
        ...baseEvent,
        type: 'trade.intent.received',
        timestamp: Date.now(),
        message: 'Trade intent received',
      },
      'INFO',
      'trade_intent_received',
    );

    try {
      const plan = await this.core.prepareTrade({
        ...dto,
        amountIn: amountInNative,
        maxSlippageBps,
      });
      await this.tradeRepo.attachPlan({ tradeId: tradeRecord.id, plan });

      this.emit(
        {
          ...baseEvent,
          type:
            plan.status === 'ready' ? 'trade.plan.ready' : 'trade.plan.rejected',
          timestamp: plan.createdAt,
          message:
            plan.status === 'ready'
              ? `nBBO selected ${plan.selectedRoute?.quote.source} at ${plan.selectedRoute?.quote.price?.toFixed(
                  6,
                )}`
              : plan.rejectionReason ?? 'Plan rejected',
          data: plan,
        },
        plan.status === 'ready' ? 'INFO' : 'WARN',
        plan.status === 'ready' ? 'plan_ready' : 'plan_rejected',
        { plan },
      );

      return { tradeId: tradeRecord.id, plan };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.tradeRepo.markRejected({
        tradeId: tradeRecord.id,
        reason,
      });
      this.emit(
        {
          ...baseEvent,
          type: 'trade.error',
          timestamp: Date.now(),
          message: reason,
        },
        'ERROR',
        'plan_error',
        { error: reason },
      );
      throw error;
    }
  }

  async confirmExecution(input: {
    tradeId: string;
    status: 'SUBMITTED' | 'CONFIRMED' | 'FAILED';
    txSignature?: string;
    executionPrice?: number;
    message?: string;
  }): Promise<void> {
    const updated = await this.tradeRepo.markExecution({
      tradeId: input.tradeId,
      status: input.status,
      txSignature: input.txSignature,
      executionPrice: input.executionPrice,
      rejectionReason: input.status === 'FAILED' ? input.message : undefined,
    });

    const eventType: TradeEvent['type'] =
      input.status === 'SUBMITTED'
        ? 'trade.submitted'
        : input.status === 'CONFIRMED'
        ? 'trade.confirmed'
        : 'trade.failed';

    this.emit(
      {
        type: eventType,
        tradeId: updated.id,
        intentId: updated.intentId ?? undefined,
        userPubkey: updated.userPubkey ?? undefined,
        pair: updated.pair,
        side: updated.side as 'buy' | 'sell',
        timestamp: Date.now(),
        message:
          input.message ??
          (input.status === 'CONFIRMED'
            ? `Tx confirmed${input.txSignature ? `: ${input.txSignature}` : ''}`
            : input.status === 'FAILED'
            ? 'Trade execution failed'
            : 'Trade submitted to network'),
        data: { txSignature: input.txSignature, executionPrice: input.executionPrice },
      },
      input.status === 'FAILED' ? 'ERROR' : 'INFO',
      `trade_${input.status.toLowerCase()}`,
      { txSignature: input.txSignature, executionPrice: input.executionPrice },
    );
  }

  async getMarketNbbo(query: MarketNbboQuery): Promise<NbboSnapshot> {
    const pair = getTokenPair(query.pair ?? 'SOL/USDC');
    const slippageBps = query.slippageBps ?? 100;

    if (!this.configService.realtime.enableRealDex) {
      // Pair-aware mid: reference USD price per base asset, with a fixed
      // Injective premium so the cross-chain nBBO + arb scan stay meaningful
      // (and the arb strategy can actually emit signals above bridge cost).
      const refMid = Number(query.mockMid ?? referencePriceFor(pair));
      const mid =
        pair.chain === 'injective'
          ? refMid * (1 + INJECTIVE_MOCK_OFFSET_BPS / 10_000)
          : refMid;
      const aggregator = new DexOrderBookAggregator([
        new MockDexAdapter({
          source: 'mock',
          midPrice: mid,
          bidSpreadBps: 7,
          askSpreadBps: 9,
          liquidityUsd: 2_500_000,
        }),
      ]);
      const book = await aggregator.queryBook(
        buildBidRequest(pair, query.bidBaseAmount ?? 1, slippageBps),
        buildAskRequest(pair, query.askQuoteAmount ?? mid, slippageBps),
      );
      return this.nbbo.calculate(book);
    }

    const book: AggregatedOrderBook = await this.aggregator.queryBook(
      buildBidRequest(pair, query.bidBaseAmount ?? 1, slippageBps),
      buildAskRequest(pair, query.askQuoteAmount ?? 160, slippageBps),
    );
    return this.nbbo.calculate(book);
  }

  async listTrades(limit = 50) {
    return this.tradeRepo.listRecent(limit);
  }

  async getTrade(id: string) {
    return this.tradeRepo.findById(id);
  }

  /**
   * Quick way to estimate minOutAmount without persisting the trade.
   * Useful for UI quote previews.
   */
  computeMinOut(plan: TradeExecutionPlan): bigint | undefined {
    if (!plan.selectedRoute) return undefined;
    return applyBps(plan.selectedRoute.quote.outAmount, plan.intent.maxSlippageBps);
  }

  /**
   * Scan shared assets (BTC, ETH) across Solana and Injective nBBO snapshots and
   * return cross-chain arbitrage signals. This is the "跨链量化辅助" online layer.
   */
  async getCrossChainArb(options: CrossChainArbOptions = {}): Promise<{
    signals: CrossChainArbSignal[];
    snapshots: Record<string, NbboSnapshot>;
  }> {
    const assets = options.assets ?? ['BTC', 'ETH'];
    const snapshots: Record<string, NbboSnapshot> = {};

    for (const asset of assets) {
      for (const chain of ['solana', 'injective'] as const) {
        const symbol = pairSymbolForChain(asset, chain);
        if (!symbol) continue;
        if (snapshots[symbol]) continue;
        try {
          snapshots[symbol] = await this.getMarketNbbo({ pair: symbol, slippageBps: 100 });
        } catch (error) {
          this.logger.warn(`nBBO fetch failed for ${symbol}: ${(error as Error).message}`);
        }
      }
    }

    const signals = this.arbStrategy.detectArb(snapshots, options);
    return { signals, snapshots };
  }

  private buildLiveAdapters(): DexAdapter[] {
    const cfg = this.configService.realtime;
    const connection = new Connection(cfg.solanaRpcUrl, 'confirmed');
    return [
      new JupiterQuoteAdapter({ apiKey: cfg.jupiterApiKey }),
      new RaydiumOrderBookAdapter({ connection }),
      new OrcaWhirlpoolOrderBookAdapter({
        connection,
        walletPublicKey: cfg.orcaWalletPublicKey,
        poolsByPair: parsePoolMap(cfg.orcaPoolsByPair),
      }),
    ];
  }

  private buildInjectiveAdapter(): InjectiveHelixAdapter {
    const injCfg = this.configService.injective;
    const markets: Record<string, InjectiveHelixMarket> = { ...INJECTIVE_HELIX_MARKETS };
    for (const [pair, meta] of Object.entries(parseHelixMarketMap(injCfg.helixMarkets))) {
      markets[normalizePairSymbol(pair)] = meta;
    }
    return new InjectiveHelixAdapter({
      markets,
      apiBaseUrl: injCfg.exchangeApi,
      getMidPrice: (symbol) => this.priceCache.get(symbol)?.price,
      mockFallbackOffsetBps: INJECTIVE_MOCK_OFFSET_BPS,
    });
  }

  private buildInjectiveExecutor(): InjectiveTradeExecutor {
    const injCfg = this.configService.injective;
    if (injCfg.mnemonic) {
      const client = new InjectiveMcpClient({
        bin: injCfg.mcpBin,
        network: injCfg.network,
        mnemonic: injCfg.mnemonic,
      });
      this.disposables.push(() => void client.onModuleDestroy());
      return client;
    }
    this.logger.warn(
      'INJECTIVE_MNEMONIC not set — using MockInjectiveTradeExecutor (no real signing)',
    );
    return new MockInjectiveTradeExecutor();
  }

  /**
   * Execute a previously-prepared Injective trade plan via the MCP server.
   * Signing is explicit (not done in prepareTrade) so the user keeps final say.
   */
  async executeInjectiveTrade(input: {
    tradeId: string;
    options?: Record<string, unknown>;
  }): Promise<InjectiveTradeResult> {
    if (!this.injectiveExecutor) {
      throw new Error('Injective execution is not enabled (set ENABLE_INJECTIVE=true)');
    }
    const trade = await this.tradeRepo.findById(input.tradeId);
    if (!trade || !trade.plan) {
      throw new Error(`Trade ${input.tradeId} not found or has no plan`);
    }
    const plan = trade.plan as unknown as TradeExecutionPlan;
    if (!plan.injectiveExecutionPlan) {
      throw new Error(`Trade ${input.tradeId} has no Injective execution plan`);
    }

    const result = await this.injectiveExecutor.executeTrade({
      plan: plan.injectiveExecutionPlan,
      intent: plan.intent,
      options: input.options,
    });

    await this.confirmExecution({
      tradeId: input.tradeId,
      status: result.status === 'failed' ? 'FAILED' : result.status === 'confirmed' ? 'CONFIRMED' : 'SUBMITTED',
      txSignature: result.txHash,
      executionPrice: plan.selectedRoute?.quote.price,
      message: result.message,
    });

    return result;
  }

  private subscribePythBroadcast(): void {
    const pairs = Object.values(ALL_PAIRS).filter((pair) =>
      pair.base.pythPriceId && pair.quote.isStableQuote,
    );
    if (pairs.length === 0) {
      return;
    }

    // Warm the cache so the first trade after boot has a mid price ready.
    this.priceFeed
      .getLatest(pairs)
      .then((updates) => {
        for (const update of updates.values()) {
          this.priceCache.set(update.symbol, update);
        }
        this.logger.log(
          `Cached initial Pyth prices for ${[...updates.keys()].join(', ')}`,
        );
      })
      .catch((error) =>
        this.logger.warn(
          `Failed to warm Pyth price cache: ${(error as Error).message}`,
        ),
      );

    this.priceFeed
      .subscribe(pairs, (update) => {
        this.priceCache.set(update.symbol, update);
        this.gateway.emitPriceUpdate({
          type: 'price.update',
          symbol: update.symbol,
          price: update.price,
          confidenceBps: update.confidenceBps,
          isStale: update.isStale,
          publishTime: update.publishTime,
          receivedAt: update.receivedAt,
        });
      })
      .then((subscription) => {
        this.priceSubscription = subscription;
        this.logger.log(
          `Subscribed Pyth stream for ${pairs.map((p) => p.symbol).join(', ')}`,
        );
      })
      .catch((error) => {
        this.logger.warn(
          `Failed to subscribe to Pyth stream: ${(error as Error).message}`,
        );
      });
  }

  private emit(
    event: TradeEvent,
    level: RealtimeLogLevel,
    logEvent: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.gateway.emitTradeEvent(event);
    void this.tradeRepo.log(event.tradeId, level, logEvent, event.message, metadata);
  }
}

function buildBidRequest(
  pair: TokenPair,
  baseAmount: number | string,
  slippageBps: number,
): DexQuoteRequest {
  return {
    pair,
    side: 'bid',
    amountIn: toNativeAmount(String(baseAmount), pair.base.decimals),
    slippageBps,
  };
}

function buildAskRequest(
  pair: TokenPair,
  quoteAmount: number | string,
  slippageBps: number,
): DexQuoteRequest {
  return {
    pair,
    side: 'ask',
    amountIn: toNativeAmount(String(quoteAmount), pair.quote.decimals),
    slippageBps,
  };
}

function parsePoolMap(value: string | undefined): Record<string, string> {
  if (!value) {
    return {};
  }

  return value.split(',').reduce<Record<string, string>>((accumulator, item) => {
    const [pair, pool] = item.split('=');
    if (pair && pool) {
      accumulator[normalizePairSymbol(pair)] = pool.trim();
    }
    return accumulator;
  }, {});
}

function parseHelixMarketMap(value: string | undefined): Record<string, InjectiveHelixMarket> {
  if (!value) {
    return {};
  }
  return value.split(',').reduce<Record<string, InjectiveHelixMarket>>((accumulator, item) => {
    const [pair, rest] = item.split('=');
    if (!pair || !rest) return accumulator;
    const [marketId, type] = rest.split(':');
    if (!marketId) return accumulator;
    accumulator[pair.trim()] = {
      marketId: marketId.trim(),
      type: (type?.trim() === 'derivative' ? 'derivative' : 'spot') as 'spot' | 'derivative',
    };
    return accumulator;
  }, {});
}

// Helper exports for tests
export type { TradeIntent };
