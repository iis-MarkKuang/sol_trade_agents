import { useCallback, useEffect, useMemo, useState } from "react";
import {
  realtimeApi,
  type NbboSnapshot,
  type PreparedTradeResponse,
  type TradeRecord
} from "../lib/api";
import {
  formatBps,
  formatCompactUsd,
  formatNumber,
  formatRelative,
  formatUsd,
  shortenAddress
} from "../lib/format";
import { subscribeToPrices, subscribeToTrade, useSocketStore } from "../lib/websocket";

const PAIRS = ["SOL/USDC", "BTC/USDC", "ETH/USDC"];

export function LiveTradingPage() {
  const [pair, setPair] = useState("SOL/USDC");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("160");
  const [maxSlippageBps, setMaxSlippageBps] = useState("100");
  const [user, setUser] = useState("");
  const [snapshot, setSnapshot] = useState<NbboSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [lastPrepared, setLastPrepared] = useState<PreparedTradeResponse | null>(null);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const tradeEvents = useSocketStore((state) => state.tradeEvents);
  const prices = useSocketStore((state) => state.prices);

  useEffect(() => {
    subscribeToPrices(PAIRS);
  }, []);

  const refreshTrades = useCallback(async () => {
    try {
      const { data } = await realtimeApi.trades(20);
      setTrades(data);
    } catch (err) {
      console.warn(err);
    }
  }, []);

  const refreshNbbo = useCallback(async () => {
    setSnapshotLoading(true);
    try {
      const { data } = await realtimeApi.nbbo({ pair });
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSnapshotLoading(false);
    }
  }, [pair]);

  useEffect(() => {
    refreshNbbo();
    refreshTrades();
  }, [refreshNbbo, refreshTrades]);

  // When a trade lifecycle event arrives, refresh trade history.
  useEffect(() => {
    if (tradeEvents.length === 0) return;
    refreshTrades();
  }, [tradeEvents, refreshTrades]);

  const livePrice = prices[pair];

  const decimalsForAmount = useMemo(() => {
    return side === "buy" ? 6 : pair.startsWith("SOL/") ? 9 : 8;
  }, [pair, side]);

  const handlePrepare = async () => {
    setPreparing(true);
    setError(null);
    try {
      const amountIn = nativeAmount(amount, decimalsForAmount);
      const { data } = await realtimeApi.prepare({
        pair,
        side,
        amountIn,
        maxSlippageBps: Number(maxSlippageBps),
        user: user.trim() || undefined
      });
      setLastPrepared(data);
      subscribeToTrade(data.tradeId);
      await refreshTrades();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(extractApiMessage(message, err));
    } finally {
      setPreparing(false);
    }
  };

  const handleConfirm = async (status: "SUBMITTED" | "CONFIRMED" | "FAILED") => {
    if (!lastPrepared) return;
    setConfirming(true);
    setError(null);
    try {
      await realtimeApi.confirm({
        tradeId: lastPrepared.tradeId,
        status,
        txSignature:
          status !== "FAILED"
            ? `mock_${lastPrepared.tradeId.slice(0, 8)}_${Date.now().toString(36)}`
            : undefined,
        executionPrice: lastPrepared.plan.selectedRoute?.quote.price,
        message:
          status === "FAILED"
            ? "Simulated failure from demo UI"
            : undefined
      });
      await refreshTrades();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        <StatCard
          label={`Oracle ${pair}`}
          value={livePrice ? formatUsd(livePrice.price) : "—"}
          hint={livePrice ? `± ${formatBps(livePrice.confidenceBps)}` : "Waiting for Pyth…"}
          glow={livePrice && !livePrice.isStale}
        />
        <StatCard
          label="Best Bid"
          value={snapshot?.bestBid ? formatUsd(snapshot.bestBid.price) : "—"}
          hint={snapshot?.bestBid ? snapshot.bestBid.source.toUpperCase() : undefined}
        />
        <StatCard
          label="Best Ask"
          value={snapshot?.bestAsk ? formatUsd(snapshot.bestAsk.price) : "—"}
          hint={snapshot?.bestAsk ? snapshot.bestAsk.source.toUpperCase() : undefined}
        />
        <StatCard
          label="Spread"
          value={snapshot?.spreadBps != null ? formatBps(snapshot.spreadBps) : "—"}
          hint={snapshot ? `${snapshot.quoteCount} quotes` : undefined}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="card lg:col-span-2">
          <h3 className="text-lg font-semibold text-slate-100">Prepare Trade</h3>
          <p className="mb-4 text-xs text-slate-400">
            Runs the full nBBO pipeline: Pyth oracle → multi-DEX aggregation → route selection → risk check.
          </p>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Pair</label>
                <select className="select" value={pair} onChange={(e) => setPair(e.target.value)}>
                  {PAIRS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Side</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSide("buy")}
                    className={
                      side === "buy"
                        ? "btn bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40"
                        : "btn-secondary"
                    }
                  >
                    Buy
                  </button>
                  <button
                    type="button"
                    onClick={() => setSide("sell")}
                    className={
                      side === "sell"
                        ? "btn bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/40"
                        : "btn-secondary"
                    }
                  >
                    Sell
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">
                  Amount ({side === "buy" ? quoteToken(pair) : baseToken(pair)})
                </label>
                <input
                  className="input"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.0"
                />
              </div>
              <div>
                <label className="label">Max slippage (bps)</label>
                <input
                  className="input"
                  value={maxSlippageBps}
                  onChange={(e) => setMaxSlippageBps(e.target.value)}
                  inputMode="numeric"
                  placeholder="100"
                />
              </div>
            </div>

            <div>
              <label className="label">Wallet (demo only, not signed)</label>
              <input
                className="input font-mono text-xs"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="Optional Solana pubkey"
              />
            </div>

            <button
              onClick={handlePrepare}
              disabled={preparing || !amount || Number(amount) <= 0}
              className="btn-primary w-full"
            >
              {preparing ? "Preparing…" : "Prepare nBBO Trade"}
            </button>

            {error && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                {error}
              </div>
            )}
          </div>

          {lastPrepared && (
            <PreparedSummary
              prepared={lastPrepared}
              onConfirm={handleConfirm}
              confirming={confirming}
            />
          )}
        </section>

        <section className="card lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-100">nBBO Snapshot</h3>
              <p className="text-xs text-slate-400">
                Aggregated quotes across configured DEXes for {pair}.
              </p>
            </div>
            <button onClick={refreshNbbo} className="btn-secondary text-xs" disabled={snapshotLoading}>
              {snapshotLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {snapshot ? (
            <div className="grid gap-4 md:grid-cols-2">
              <SideCard
                title="Best Bid"
                tone="green"
                empty="No bids available."
                quote={snapshot.bestBid}
              />
              <SideCard
                title="Best Ask"
                tone="red"
                empty="No asks available."
                quote={snapshot.bestAsk}
              />
              <div className="md:col-span-2 grid gap-3 sm:grid-cols-3 text-sm">
                <Stat label="Bid depth (USD)" value={formatCompactUsd(snapshot.bidDepthUsd)} />
                <Stat label="Ask depth (USD)" value={formatCompactUsd(snapshot.askDepthUsd)} />
                <Stat label="DEX failures" value={snapshot.failures.length.toString()} />
              </div>
              {snapshot.failures.length > 0 && (
                <div className="md:col-span-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
                  <p className="mb-1 font-semibold">DEX failures during quote:</p>
                  <ul className="list-disc space-y-1 pl-4">
                    {snapshot.failures.map((failure, idx) => (
                      <li key={idx}>
                        <code>{failure.source}</code> [{failure.side}] — {failure.message} ({failure.latencyMs}ms)
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Loading nBBO snapshot…</p>
          )}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <SectionHeader title="Trade Event Feed" subtitle="Live WebSocket lifecycle events" />
          {tradeEvents.length === 0 ? (
            <Empty text="No trade events yet. Prepare a trade to see lifecycle updates." />
          ) : (
            <ul className="space-y-2">
              {tradeEvents.slice(0, 15).map((event, idx) => (
                <li
                  key={`${event.tradeId}-${event.timestamp}-${idx}`}
                  className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-sky-300">{event.type}</span>
                    <span className="text-xs text-slate-400">{formatRelative(event.timestamp)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-300">
                    <span>{event.pair}</span>
                    <span className="uppercase">{event.side}</span>
                    <span className="font-mono">{shortenAddress(event.tradeId, 6, 4)}</span>
                  </div>
                  {event.message && (
                    <p className="mt-1 text-xs text-slate-400">{event.message}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <SectionHeader title="Recent Trades" subtitle="Persisted trade history" />
          {trades.length === 0 ? (
            <Empty text="No trades yet." />
          ) : (
            <ul className="space-y-2">
              {trades.map((t) => (
                <li key={t.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ActionBadge action={t.side} />
                      <span className="font-semibold text-slate-100">{t.pair}</span>
                      <StatusBadge status={t.status} />
                    </div>
                    <span className="text-xs text-slate-400">{formatRelative(t.createdAt)}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-400">
                    <div>
                      <span className="text-slate-500">DEX</span>{" "}
                      <span className="text-slate-200">{t.selectedDex ?? "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Exec price</span>{" "}
                      <span className="text-slate-200">{formatUsd(t.executionPrice ?? undefined)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Slippage</span>{" "}
                      <span className="text-slate-200">{t.maxSlippageBps} bps</span>
                    </div>
                  </div>
                  {t.txSignature && (
                    <p className="mt-1 truncate font-mono text-xs text-sky-300">
                      tx: {t.txSignature}
                    </p>
                  )}
                  {t.rejectionReason && (
                    <p className="mt-1 text-xs text-rose-300">{t.rejectionReason}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function PreparedSummary({
  prepared,
  onConfirm,
  confirming
}: {
  prepared: PreparedTradeResponse;
  onConfirm: (status: "SUBMITTED" | "CONFIRMED" | "FAILED") => void;
  confirming: boolean;
}) {
  const route = prepared.plan.selectedRoute?.quote;
  const oracle = prepared.plan.oraclePrice;
  return (
    <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-emerald-300">
          Plan {prepared.plan.status}
        </span>
        <span className="font-mono text-xs text-slate-400">
          {shortenAddress(prepared.tradeId, 8, 6)}
        </span>
      </div>
      {route ? (
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-200">
          <Stat label="Selected DEX" value={route.source.toUpperCase()} />
          <Stat label="Quote price" value={formatUsd(route.price)} />
          <Stat label="Oracle price" value={formatUsd(oracle?.price)} />
          <Stat label="Liquidity" value={formatCompactUsd(route.liquidityUsd)} />
          <Stat label="Price impact" value={formatBps(route.priceImpactBps)} />
          <Stat label="Route latency" value={`${route.latencyMs} ms`} />
        </div>
      ) : (
        <p className="mt-2 text-xs text-rose-200">
          {prepared.plan.rejectionReason || "Plan rejected"}
        </p>
      )}

      {prepared.plan.status === "ready" && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button onClick={() => onConfirm("SUBMITTED")} disabled={confirming} className="btn-secondary text-xs">
            Mark Submitted
          </button>
          <button
            onClick={() => onConfirm("CONFIRMED")}
            disabled={confirming}
            className="btn bg-emerald-500/20 text-emerald-100 ring-1 ring-emerald-500/40 text-xs"
          >
            Mark Confirmed
          </button>
          <button
            onClick={() => onConfirm("FAILED")}
            disabled={confirming}
            className="btn bg-rose-500/20 text-rose-100 ring-1 ring-rose-500/40 text-xs"
          >
            Mark Failed
          </button>
        </div>
      )}
    </div>
  );
}

function SideCard({
  title,
  tone,
  quote,
  empty
}: {
  title: string;
  tone: "green" | "red";
  quote?: NbboSnapshot["bestBid"];
  empty: string;
}) {
  const bgClass =
    tone === "green"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : "border-rose-500/30 bg-rose-500/5";
  return (
    <div className={`rounded-xl border ${bgClass} p-4`}>
      <p className="stat-label">{title}</p>
      {quote ? (
        <>
          <p className="stat-value mt-1">{formatUsd(quote.price)}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
            <div>
              <p className="text-slate-500">DEX</p>
              <p className="font-medium text-slate-100">{quote.source.toUpperCase()}</p>
            </div>
            <div>
              <p className="text-slate-500">Liquidity</p>
              <p>{formatCompactUsd(quote.liquidityUsd)}</p>
            </div>
            <div>
              <p className="text-slate-500">Fee</p>
              <p>{formatBps(quote.feeBps)}</p>
            </div>
            <div>
              <p className="text-slate-500">Impact</p>
              <p>{formatBps(quote.priceImpactBps)}</p>
            </div>
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-400">{empty}</p>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  glow
}: {
  label: string;
  value: string;
  hint?: string;
  glow?: boolean;
}) {
  return (
    <div className={`card ${glow ? "ring-1 ring-emerald-500/30" : ""}`}>
      <p className="stat-label">{label}</p>
      <p className="stat-value mt-1">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-base font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
      {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-4 text-center text-sm text-slate-400">
      {text}
    </p>
  );
}

function ActionBadge({ action }: { action: string }) {
  const norm = action.toLowerCase();
  if (norm === "buy") return <span className="badge-green">BUY</span>;
  if (norm === "sell") return <span className="badge-red">SELL</span>;
  return <span className="badge-slate">{action.toUpperCase()}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: "badge-slate",
    READY: "badge-blue",
    REJECTED: "badge-red",
    SUBMITTED: "badge-amber",
    CONFIRMED: "badge-green",
    FAILED: "badge-red"
  };
  const klass = map[status] ?? "badge-slate";
  return <span className={klass}>{status}</span>;
}

function quoteToken(pair: string): string {
  return pair.split("/")[1];
}

function baseToken(pair: string): string {
  return pair.split("/")[0];
}

function nativeAmount(value: string, decimals: number): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "0";
  const factor = Math.pow(10, decimals);
  const scaled = Math.floor(numeric * factor);
  return scaled.toString();
}

function extractApiMessage(fallback: string, err: unknown): string {
  if (typeof err === "object" && err !== null && "response" in err) {
    const response = (err as { response?: { data?: { message?: string | string[] } } }).response;
    if (response?.data?.message) {
      return Array.isArray(response.data.message)
        ? response.data.message.join(", ")
        : response.data.message;
    }
  }
  return fallback;
}
