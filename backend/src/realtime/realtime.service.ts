import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Connection } from '@solana/web3.js';
import { ConfigService } from '../config/config.service';
import { DEFAULT_PAIRS, getTokenPair, normalizePairSymbol } from '../config/tokens.js';
import { RealTimeAgentCore } from '../agent/realtime-agent-core.js';
import type { DexAdapter } from '../dex/adapter.js';
import { DexOrderBookAggregator } from '../dex/aggregator.js';
import { JupiterQuoteAdapter } from '../dex/jupiter-adapter.js';
import { MockDexAdapter } from '../dex/mock-adapter.js';
import { OracleMockAdapter } from '../dex/oracle-mock-adapter.js';
import { OrcaWhirlpoolOrderBookAdapter } from '../dex/orca-adapter.js';
import { RaydiumOrderBookAdapter } from '../dex/raydium-adapter.js';
import { NbboEngine } from '../nbbo/engine.js';
import {
  PythPriceFeedService,
  type PriceFeedSubscriber,
  type PriceFeedSubscription,
} from '../oracle/pyth-price-feed.js';
import { RiskEngine } from '../risk/risk-engine.js';
import { JupiterTransactionBuilder } from '../transactions/jupiter-transaction-builder.js';
import type {
  AggregatedOrderBook,
  DexQuoteRequest,
  NbboSnapshot,
  PriceUpdate,
  RiskPolicy,
  TokenPair,
  TradeExecutionPlan,
  TradeIntent,
} from '../types.js';
import { applyBps, toNativeAmount } from '../utils/amounts.js';
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

@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);

  private core!: RealTimeAgentCore;
  private aggregator!: DexOrderBookAggregator;
  private nbbo = new NbboEngine();
  private priceFeed!: PriceFeedSubscriber;
  private priceSubscription?: PriceFeedSubscription;
  private policy!: RiskPolicy;
  private readonly priceCache = new Map<string, PriceUpdate>();

  constructor(
    private readonly configService: ConfigService,
    private readonly tradeRepo: RealtimeTradeRepository,
    private readonly gateway: RealtimeGateway,
  ) {}

  onModuleInit(): void {
    const cfg = this.configService.realtime;
    this.policy = {
      allowedPairs: Object.keys(DEFAULT_PAIRS),
      allowedDexes: cfg.enableRealDex
        ? ['jupiter', 'raydium', 'orca', 'mock']
        : ['mock'],
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

    this.aggregator = new DexOrderBookAggregator(adapters, {
      quoteTimeoutMs: cfg.dexQuoteTimeoutMs,
    });

    this.core = new RealTimeAgentCore({
      priceFeed: this.priceFeed,
      aggregator: this.aggregator,
      nbbo: this.nbbo,
      risk: new RiskEngine(),
      policy: this.policy,
      tokenPairs: DEFAULT_PAIRS,
      txBuilder: cfg.enableRealDex
        ? new JupiterTransactionBuilder({ apiKey: cfg.jupiterApiKey })
        : undefined,
      retries: cfg.retries,
    });

    this.subscribePythBroadcast();
    this.logger.log(
      `Realtime agent initialised (realDex=${cfg.enableRealDex}, pairs=${Object.keys(
        DEFAULT_PAIRS,
      ).join(',')})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    try {
      this.priceSubscription?.close();
    } catch (error) {
      this.logger.warn(`Failed to close Pyth subscription: ${(error as Error).message}`);
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
    const tradeRecord = await this.tradeRepo.createTrade({
      intentId: dto.id,
      userPubkey: dto.user,
      pair: dto.pair,
      side: dto.side,
      amountIn: BigInt(dto.amountIn.toString()),
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
      const mid = Number(query.mockMid ?? 160);
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

  private subscribePythBroadcast(): void {
    const pairs = Object.values(DEFAULT_PAIRS).filter((pair) =>
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

// Helper exports for tests
export type { TradeIntent };
