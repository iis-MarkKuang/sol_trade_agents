import { EventSource } from "eventsource";
import { z } from "zod";
import { resolvePythPriceId } from "../config/tokens.js";
import type { PriceUpdate, TokenPair } from "../types.js";

const HermesParsedPriceSchema = z.object({
  id: z.string(),
  price: z.object({
    price: z.union([z.string(), z.number()]),
    conf: z.union([z.string(), z.number()]),
    expo: z.number(),
    publish_time: z.number()
  })
});

export interface PriceFeedSubscription {
  close(): void;
}

export interface PriceFeedReader {
  getLatest(pairs: TokenPair[]): Promise<Map<string, PriceUpdate>>;
}

export interface PriceFeedSubscriber extends PriceFeedReader {
  subscribe(pairs: TokenPair[], onUpdate: (update: PriceUpdate) => void): Promise<PriceFeedSubscription>;
}

export interface PythPriceFeedConfig {
  endpoint?: string;
  staleMs?: number;
  maxConfidenceBps?: number;
}

export class PythPriceFeedService implements PriceFeedSubscriber {
  private readonly endpoint: string;
  private readonly staleMs: number;
  private readonly maxConfidenceBps: number;

  constructor(config: PythPriceFeedConfig = {}) {
    this.endpoint = config.endpoint ?? "https://hermes.pyth.network";
    this.staleMs = config.staleMs ?? 15_000;
    this.maxConfidenceBps = config.maxConfidenceBps ?? 75;
  }

  async getLatest(pairs: TokenPair[]): Promise<Map<string, PriceUpdate>> {
    const priceIds = uniquePriceIds(pairs);
    const response = await fetchJson(buildHermesUrl(this.endpoint, "/v2/updates/price/latest", priceIds));
    const updates = parseHermesPayload(response, {
      staleMs: this.staleMs,
      maxConfidenceBps: this.maxConfidenceBps
    });
    return mapUpdatesToPairs(pairs, updates);
  }

  async subscribe(
    pairs: TokenPair[],
    onUpdate: (update: PriceUpdate) => void
  ): Promise<PriceFeedSubscription> {
    const priceIds = uniquePriceIds(pairs);
    const eventSource = new EventSource(buildHermesUrl(this.endpoint, "/v2/updates/price/stream", priceIds));

    eventSource.onmessage = (event: MessageEvent) => {
      const updates = parseHermesPayload(JSON.parse(event.data), {
        staleMs: this.staleMs,
        maxConfidenceBps: this.maxConfidenceBps
      });
      const pairUpdates = mapUpdatesToPairs(pairs, updates);
      for (const update of pairUpdates.values()) {
        onUpdate(update);
      }
    };

    return {
      close() {
        eventSource.close();
      }
    };
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Pyth Hermes request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function buildHermesUrl(endpoint: string, path: string, priceIds: string[]): string {
  const url = new URL(path, endpoint);
  for (const priceId of priceIds) {
    url.searchParams.append("ids[]", stripHexPrefix(priceId));
  }
  url.searchParams.set("encoding", "hex");
  url.searchParams.set("parsed", "true");
  return url.toString();
}

export class MockPythPriceFeedService implements PriceFeedSubscriber {
  constructor(private readonly prices: Record<string, number>) {}

  async getLatest(pairs: TokenPair[]): Promise<Map<string, PriceUpdate>> {
    const now = Date.now();
    const updates = new Map<string, PriceUpdate>();
    for (const pair of pairs) {
      const price = this.prices[pair.symbol];
      if (!price) {
        throw new Error(`Missing mock Pyth price for ${pair.symbol}`);
      }

      updates.set(pair.symbol, {
        symbol: pair.symbol,
        priceId: resolvePythPriceId(pair),
        price,
        confidence: price * 0.0005,
        expo: -8,
        publishTime: Math.floor(now / 1000),
        receivedAt: now,
        confidenceBps: 5,
        isStale: false
      });
    }

    return updates;
  }

  async subscribe(
    pairs: TokenPair[],
    onUpdate: (update: PriceUpdate) => void
  ): Promise<PriceFeedSubscription> {
    const updates = await this.getLatest(pairs);
    for (const update of updates.values()) {
      queueMicrotask(() => onUpdate(update));
    }
    return { close() {} };
  }
}

export function parseHermesPayload(
  payload: unknown,
  options: { staleMs: number; maxConfidenceBps: number }
): Map<string, PriceUpdate> {
  const now = Date.now();
  const parsedItems = extractParsedItems(payload);
  const vaaByIndex = extractVaas(payload);
  const updates = new Map<string, PriceUpdate>();

  parsedItems.forEach((item, index) => {
    const parsed = HermesParsedPriceSchema.parse(item);
    const price = Number(parsed.price.price) * 10 ** parsed.price.expo;
    const confidence = Number(parsed.price.conf) * 10 ** parsed.price.expo;
    const confidenceBps = price === 0 ? Number.POSITIVE_INFINITY : Math.abs(confidence / price) * 10_000;
    const ageMs = now - parsed.price.publish_time * 1000;

    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Invalid Pyth price for ${parsed.id}`);
    }

    if (confidenceBps > options.maxConfidenceBps) {
      throw new Error(`Pyth confidence too wide for ${parsed.id}: ${confidenceBps.toFixed(2)} bps`);
    }

    const priceId = normalizePriceId(parsed.id);
    updates.set(priceId, {
      symbol: priceId,
      priceId,
      price,
      confidence,
      expo: parsed.price.expo,
      publishTime: parsed.price.publish_time,
      receivedAt: now,
      confidenceBps,
      isStale: ageMs > options.staleMs,
      vaa: vaaByIndex[index],
      raw: item
    });
  });

  return updates;
}

function uniquePriceIds(pairs: TokenPair[]): string[] {
  return Array.from(new Set(pairs.map((pair) => resolvePythPriceId(pair))));
}

function mapUpdatesToPairs(pairs: TokenPair[], updates: Map<string, PriceUpdate>): Map<string, PriceUpdate> {
  const mapped = new Map<string, PriceUpdate>();
  for (const pair of pairs) {
    const priceId = normalizePriceId(resolvePythPriceId(pair));
    const update = updates.get(priceId);
    if (!update) {
      throw new Error(`Pyth response did not include feed ${priceId} for ${pair.symbol}`);
    }

    mapped.set(pair.symbol, { ...update, symbol: pair.symbol, priceId });
  }

  return mapped;
}

function extractParsedItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const candidate = payload as { parsed?: unknown; price_feeds?: unknown };
    if (Array.isArray(candidate.parsed)) {
      return candidate.parsed;
    }
    if (Array.isArray(candidate.price_feeds)) {
      return candidate.price_feeds;
    }
  }

  throw new Error("Pyth Hermes payload did not contain parsed price updates");
}

function extractVaas(payload: unknown): Array<string | undefined> {
  if (payload && typeof payload === "object") {
    const binary = (payload as { binary?: { data?: unknown } }).binary;
    if (binary && Array.isArray(binary.data)) {
      return binary.data.map((item) => (typeof item === "string" ? item : undefined));
    }
  }

  return [];
}

function normalizePriceId(priceId: string): string {
  return priceId.toLowerCase().startsWith("0x") ? priceId.toLowerCase() : `0x${priceId.toLowerCase()}`;
}

function stripHexPrefix(priceId: string): string {
  return priceId.toLowerCase().startsWith("0x") ? priceId.slice(2) : priceId;
}
