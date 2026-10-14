import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import axios from 'axios';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageLedgerService } from '../usage-ledger/usage-ledger.service';
import { CrawledMarketData } from './types/crawler.types';

export interface DuneTokenVolumeRow {
  blockchain: string;
  platform: string;
  token_symbol: string;
  buy_volume_usd: number;
  sell_volume_usd: number;
  total_volume_usd: number;
  token_bought_amount: number;
  token_sold_amount: number;
  trade_count: number;
  latest_trade_at: string;
}

interface DuneExecutionResponse {
  execution_id: string;
  state: string;
}

interface DuneStatusResponse {
  state: string;
  error?: string;
}

interface DuneResultsResponse {
  result?: {
    rows?: DuneTokenVolumeRow[];
  };
}

const TERMINAL_FAILURE_STATES = new Set([
  'QUERY_STATE_FAILED',
  'QUERY_STATE_CANCELLED',
  'QUERY_STATE_EXPIRED',
]);

@Injectable()
export class DuneCrawlerService {
  private readonly logger = new Logger(DuneCrawlerService.name);
  private cachedRows?: { expiresAt: number; rows: DuneTokenVolumeRow[] };
  private rowsRequest?: Promise<DuneTokenVolumeRow[]>;
  private executionDay = '';
  private executionsToday = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly usageLedger: UsageLedgerService,
  ) {}

  transformToCrawledData(data: DuneTokenVolumeRow[]): CrawledMarketData[] {
    return data.map((item) => {
      const buyVolume = Number(item.buy_volume_usd) || 0;
      const sellVolume = Number(item.sell_volume_usd) || 0;
      return {
        token: `${item.blockchain}:${item.token_symbol.toLowerCase()}`,
        symbol: item.token_symbol,
        timestamp: new Date(item.latest_trade_at),
        source: `dune:${item.blockchain}:${item.platform}`,
        chain: item.blockchain,
        platform: item.platform,
        volume24h: Number(item.total_volume_usd) || 0,
        buyVolumeUsd24h: buyVolume,
        sellVolumeUsd24h: sellVolume,
        netFlowUsd24h: buyVolume - sellVolume,
        tokenBoughtAmount24h: Number(item.token_bought_amount) || 0,
        tokenSoldAmount24h: Number(item.token_sold_amount) || 0,
        tradeCount24h: Number(item.trade_count) || 0,
        rawData: item,
      };
    });
  }

  async saveToDatabase(data: CrawledMarketData[]): Promise<void> {
    for (const item of data) {
      try {
        await this.prismaService.marketData.create({
          data: {
            token: item.token,
            symbol: item.symbol,
            timestamp: item.timestamp,
            source: item.source,
            volume24h: item.volume24h,
            rawData: item.rawData,
          },
        });
      } catch (error) {
        this.logger.error(`Failed to save Dune data for ${item.symbol}`, error);
      }
    }
  }

  buildTokenVolumeSql(): string {
    const config = this.configService.dune;
    const partitions = Math.max(1, Math.ceil(config.lookbackHours / 24));
    const evmChains = config.chains.filter((chain) => chain !== 'solana');
    const sides: string[] = [];

    if (config.chains.includes('solana')) {
      sides.push(
        this.sideSelect('dex_solana.trades', 'bought', partitions, ''),
        this.sideSelect('dex_solana.trades', 'sold', partitions, ''),
      );
    }

    if (evmChains.length > 0) {
      const chainFilter = `AND blockchain IN (${evmChains
        .map((chain) => `'${chain}'`)
        .join(', ')})`;
      sides.push(
        this.sideSelect('dex.trades', 'bought', partitions, chainFilter),
        this.sideSelect('dex.trades', 'sold', partitions, chainFilter),
      );
    }

    if (sides.length === 0) {
      throw new Error('DUNE_CHAINS contains no valid chain names');
    }

    return `
WITH token_sides AS (
${sides.join('\nUNION ALL\n')}
)
SELECT
  blockchain,
  platform,
  token_symbol,
  sum(CASE WHEN side = 'buy' THEN amount_usd ELSE 0 END) AS buy_volume_usd,
  sum(CASE WHEN side = 'sell' THEN amount_usd ELSE 0 END) AS sell_volume_usd,
  sum(amount_usd) AS total_volume_usd,
  sum(CASE WHEN side = 'buy' THEN token_amount ELSE 0 END) AS token_bought_amount,
  sum(CASE WHEN side = 'sell' THEN token_amount ELSE 0 END) AS token_sold_amount,
  count(*) AS trade_count,
  max(block_time) AS latest_trade_at
FROM token_sides
GROUP BY 1, 2, 3
ORDER BY total_volume_usd DESC
LIMIT ${config.resultLimit}`.trim();
  }

  async fetchOnChainData(): Promise<DuneTokenVolumeRow[]> {
    const cached = this.cachedRows;
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug('Using cached Dune rows (no query credits consumed)');
      if (this.usageLedger.enabled) {
        // Observability only; a cache_hit must never break the cache return.
        try {
          await this.usageLedger.recordCacheHit('dune', new Date(), this.sqlQueryKey());
        } catch (error) {
          this.logger.debug(`cache_hit recording failed: ${(error as Error).message}`);
        }
      }
      return cached.rows;
    }
    if (this.rowsRequest) {
      return this.rowsRequest;
    }

    this.rowsRequest = this.fetchFreshOnChainData();
    try {
      const rows = await this.rowsRequest;
      this.cachedRows = {
        expiresAt: Date.now() + this.configService.dune.cacheTtlMs,
        rows,
      };
      return rows;
    } finally {
      this.rowsRequest = undefined;
    }
  }

  private async fetchFreshOnChainData(): Promise<DuneTokenVolumeRow[]> {
    const config = this.configService.dune;
    if (!config.apiKey) {
      if (config.useMock) {
        this.logger.warn('DUNE_USE_MOCK is enabled; returning fixture data');
        return this.buildMockRows();
      }
      throw new Error('DUNE_API_KEY is required when DUNE_USE_MOCK is disabled');
    }

    try {
      return await this.executeSql(this.buildTokenVolumeSql());
    } catch (error) {
      if (!config.useMock) throw error;
      this.logger.warn(
        `Dune query failed; using explicit mock fallback: ${(error as Error).message}`,
      );
      return this.buildMockRows();
    }
  }

  async run(): Promise<CrawledMarketData[]> {
    this.logger.log('Starting live Dune token-volume crawler...');
    const data = await this.fetchOnChainData();
    const transformed = this.transformToCrawledData(data);
    await this.saveToDatabase(transformed);
    this.logger.log(`Successfully processed ${transformed.length} Dune rows`);
    return transformed;
  }

  private sideSelect(
    table: string,
    side: 'bought' | 'sold',
    partitionDays: number,
    chainFilter: string,
  ): string {
    const config = this.configService.dune;
    const action = side === 'bought' ? 'buy' : 'sell';
    return `SELECT
  block_time,
  blockchain,
  project AS platform,
  token_${side}_symbol AS token_symbol,
  '${action}' AS side,
  token_${side}_amount AS token_amount,
  amount_usd
FROM ${table}
WHERE block_date >= current_date - INTERVAL '${partitionDays}' DAY
  AND block_time >= now() - INTERVAL '${config.lookbackHours}' HOUR
  AND amount_usd IS NOT NULL
  AND token_${side}_symbol IS NOT NULL
  ${chainFilter}`;
  }

  private async executeSql(sql: string): Promise<DuneTokenVolumeRow[]> {
    const config = this.configService.dune;
    const headers = {
      'Content-Type': 'application/json',
      'X-Dune-Api-Key': config.apiKey,
    };

    if (this.usageLedger.enabled) {
      const today = new Date();
      const queryKey = this.sqlQueryKey();
      const reservation = await this.usageLedger.reserve('dune', today, 1, {
        unitKind: 'executions',
        queryKey,
      });
      if (!reservation.allowed) {
        throw new Error(
          `Dune daily budget exhausted (${reservation.hardLimit} executions); use cached data or retry after UTC midnight`,
        );
      }
      try {
        const execution = await axios.post<DuneExecutionResponse>(
          `${config.apiBaseUrl}/v1/sql/execute`,
          { sql, ...(config.performance ? { performance: config.performance } : {}) },
          { headers, timeout: 15_000 },
        );
        const executionId = execution.data.execution_id;
        if (!executionId) {
          throw new Error('Dune did not return an execution ID');
        }
        const rows = await this.pollAndFetchResults(
          executionId,
          execution.data.state,
          headers,
          config,
        );
        await this.usageLedger.recordActual('dune', today, reservation.reservationId, 1, {
          unitKind: 'executions',
          queryKey,
        });
        return rows;
      } catch (error) {
        await this.usageLedger.recordFailed('dune', today, reservation.reservationId, {
          unitKind: 'executions',
          queryKey,
        });
        throw error;
      }
    }

    // Legacy in-process budget (USAGE_LEDGER_ENABLED=false). Behavior is
    // unchanged from before the UsageLedger integration.
    this.assertExecutionBudget(config.maxExecutionsPerDay);
    const execution = await axios.post<DuneExecutionResponse>(
      `${config.apiBaseUrl}/v1/sql/execute`,
      {
        sql,
        ...(config.performance ? { performance: config.performance } : {}),
      },
      { headers, timeout: 15_000 },
    );
    const executionId = execution.data.execution_id;
    this.executionsToday += 1;
    this.logger.log(
      `Dune execution submitted (${this.executionsToday}/${config.maxExecutionsPerDay} daily process budget)`,
    );
    if (!executionId) {
      throw new Error('Dune did not return an execution ID');
    }

    return this.pollAndFetchResults(executionId, execution.data.state, headers, config);
  }

  /** Poll the Dune execution until completed, then fetch result rows. */
  private async pollAndFetchResults(
    executionId: string,
    initialState: string,
    headers: Record<string, string>,
    config: ConfigService['dune'],
  ): Promise<DuneTokenVolumeRow[]> {
    const deadline = Date.now() + config.queryTimeoutMs;
    let state = initialState;
    while (state !== 'QUERY_STATE_COMPLETED') {
      if (TERMINAL_FAILURE_STATES.has(state)) {
        throw new Error(`Dune execution ${executionId} ended in ${state}`);
      }
      if (Date.now() >= deadline) {
        throw new Error(`Dune execution ${executionId} timed out after ${config.queryTimeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const status = await axios.get<DuneStatusResponse>(
        `${config.apiBaseUrl}/v1/execution/${executionId}/status`,
        { headers, timeout: 15_000 },
      );
      state = status.data.state;
      if (TERMINAL_FAILURE_STATES.has(state)) {
        throw new Error(
          `Dune execution ${executionId} ended in ${state}: ${status.data.error ?? 'unknown error'}`,
        );
      }
    }

    const results = await axios.get<DuneResultsResponse>(
      `${config.apiBaseUrl}/v1/execution/${executionId}/results`,
      {
        headers,
        params: { limit: config.resultLimit },
        timeout: 30_000,
      },
    );
    return results.data.result?.rows ?? [];
  }

  private assertExecutionBudget(maxExecutionsPerDay: number): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.executionDay !== today) {
      this.executionDay = today;
      this.executionsToday = 0;
    }
    if (this.executionsToday >= maxExecutionsPerDay) {
      throw new Error(
        `Dune daily process budget exhausted (${maxExecutionsPerDay} executions); use cached data or retry after UTC midnight`,
      );
    }
  }

  /** Stable short hash of the current token-volume SQL, used as a queryKey. */
  private sqlQueryKey(): string {
    return createHash('sha256').update(this.buildTokenVolumeSql()).digest('hex').slice(0, 16);
  }

  private buildMockRows(): DuneTokenVolumeRow[] {
    return [
      {
        blockchain: 'solana',
        platform: 'mock-dex',
        token_symbol: 'SOL',
        buy_volume_usd: 5_000_000,
        sell_volume_usd: 4_800_000,
        total_volume_usd: 9_800_000,
        token_bought_amount: 25_000,
        token_sold_amount: 24_000,
        trade_count: 1_000,
        latest_trade_at: new Date().toISOString(),
      },
    ];
  }
}
