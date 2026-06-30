import { useCallback, useEffect, useState } from "react";
import {
  offlineApi,
  realtimeApi,
  type AnalysisRow,
  type CrossChainArbSignal,
  type MarketDataRow,
  type PipelineSummary,
  type TradeSignalRow
} from "../lib/api";
import { formatBps, formatCompactUsd, formatNumber, formatRelative, formatUsd } from "../lib/format";
import { useSocketStore } from "../lib/websocket";

export function InsightsPage() {
  const [marketData, setMarketData] = useState<MarketDataRow[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisRow[]>([]);
  const [signals, setSignals] = useState<TradeSignalRow[]>([]);
  const [status, setStatus] = useState<{ schedulerEnabled: boolean } | null>(null);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<PipelineSummary | null>(null);
  const [arbSignals, setArbSignals] = useState<CrossChainArbSignal[]>([]);
  const [arbLoading, setArbLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offlineEvents = useSocketStore((state) => state.offlineEvents);

  const reload = useCallback(async () => {
    try {
      const [m, a, s, st] = await Promise.all([
        offlineApi.marketData(20),
        offlineApi.analysis(3),
        offlineApi.signals(20),
        offlineApi.status()
      ]);
      setMarketData(m.data);
      setAnalysis(a.data);
      setSignals(s.data);
      setStatus(st.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const refreshArb = useCallback(async () => {
    setArbLoading(true);
    try {
      const { data } = await realtimeApi.crossChainArb({ notionalUsd: 1000, minNetEdgeBps: 30 });
      setArbSignals(data.signals);
    } catch (err) {
      console.warn("cross-chain arb failed", err);
    } finally {
      setArbLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    refreshArb();
  }, [reload, refreshArb]);

  // Auto-reload when an offline pipeline completion event arrives.
  useEffect(() => {
    if (offlineEvents[0]?.type === "pipeline.completed") {
      reload();
    }
  }, [offlineEvents, reload]);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const { data } = await offlineApi.runPipeline();
      setLastRun(data);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Pipeline runs (live)"
          value={offlineEvents.filter((e) => e.type === "pipeline.completed").length.toString()}
          hint={status?.schedulerEnabled ? "Scheduler ENABLED" : "Manual mode"}
        />
        <StatCard
          label="Market rows"
          value={marketData.length.toString()}
          hint="Recent ingest"
        />
        <StatCard label="Analyses" value={analysis.length.toString()} hint="LLM responses" />
        <StatCard
          label="Open signals"
          value={signals.filter((s) => s.status === "pending").length.toString()}
          hint={`${signals.length} total`}
        />
      </section>

      <section className="card flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Offline Agent Pipeline</h2>
          <p className="text-sm text-slate-400">
            Triggers crawl → clean → normalize → LLM analysis → strategy signals.
            Set <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">ENABLE_SCHEDULER=true</code>{" "}
            on the backend to enable scheduled execution.
          </p>
        </div>
        <button onClick={handleRun} disabled={running} className="btn-primary">
          {running ? "Running…" : "Run pipeline now"}
        </button>
      </section>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          {error}
        </div>
      )}

      {lastRun && (
        <section className="card">
          <h3 className="text-sm font-semibold text-slate-200">Last Run Summary</h3>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Duration" value={`${lastRun.durationMs} ms`} />
            <Stat label="CMC" value={lastRun.crawled.coinmarketcap.toString()} />
            <Stat label="TradingView" value={lastRun.crawled.tradingview.toString()} />
            <Stat label="Dune" value={lastRun.crawled.dune.toString()} />
            <Stat label="Cleaned" value={lastRun.cleaned.toString()} />
            <Stat label="Signals" value={lastRun.signalsGenerated.toString()} />
          </div>
          <p className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-sm leading-relaxed text-slate-200">
            {lastRun.analysisPreview}
          </p>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <SectionHeader
            title="Cross-Chain Arbitrage (Solana ↔ Injective)"
            subtitle="Live spread scan for shared assets (BTC, ETH)"
          />
          <div className="mb-3 flex justify-end">
            <button onClick={refreshArb} className="btn-secondary text-xs" disabled={arbLoading}>
              {arbLoading ? "Scanning…" : "Rescan"}
            </button>
          </div>
          {arbSignals.length === 0 ? (
            <Empty text="No actionable cross-chain arb right now. Spreads are within bridge-cost tolerance." />
          ) : (
            <ul className="space-y-2">
              {arbSignals.map((s) => (
                <li key={s.asset} className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100">{s.asset}</span>
                    <span className="text-xs text-emerald-300">net {formatBps(s.netEdgeBps)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Buy on <span className="text-emerald-300">{s.buyChain}</span>, sell on{" "}
                    <span className="text-rose-300">{s.sellChain}</span> · spread {formatBps(s.spreadBps)} ·{" "}
                    {s.bridgePath}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <SectionHeader title="Latest LLM Analysis" subtitle="Generated by the offline agent" />
          <div className="space-y-4">
            {analysis.length === 0 ? (
              <Empty text="No analysis yet. Run the pipeline to generate one." />
            ) : (
              analysis.map((row) => (
                <article key={row.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                  <header className="mb-2 flex items-center justify-between text-xs text-slate-400">
                    <span className="badge-blue">{row.type || "MARKET_OVERVIEW"}</span>
                    <span>{formatRelative(row.timestamp)}</span>
                  </header>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                    {row.content}
                  </p>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="card">
          <SectionHeader title="Trade Signals" subtitle="From registered strategies" />
          {signals.length === 0 ? (
            <Empty text="No signals yet." />
          ) : (
            <ul className="divide-y divide-slate-800/80">
              {signals.slice(0, 12).map((s) => (
                <li key={s.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <div className="font-medium text-slate-100">
                      <ActionBadge action={s.action} />
                      <span className="ml-2">{s.symbol}</span>
                      <span className="ml-1 text-xs text-slate-500">@ {formatUsd(s.price)}</span>
                    </div>
                    <p className="text-xs text-slate-400">{s.reason}</p>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <p>{s.strategy}</p>
                    <p>{formatRelative(s.timestamp)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <SectionHeader title="Recent Market Data" subtitle="Latest rows ingested" />
        {marketData.length === 0 ? (
          <Empty text="No data ingested yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-2 py-2">Symbol</th>
                  <th className="px-2 py-2">Source</th>
                  <th className="px-2 py-2 text-right">Price</th>
                  <th className="px-2 py-2 text-right">Volume 24h</th>
                  <th className="px-2 py-2 text-right">Market Cap</th>
                  <th className="px-2 py-2 text-right">RSI(14)</th>
                  <th className="px-2 py-2 text-right">TVL</th>
                  <th className="px-2 py-2 text-right">Captured</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {marketData.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-800/30">
                    <td className="px-2 py-2 font-semibold text-slate-100">{row.symbol}</td>
                    <td className="px-2 py-2 text-slate-300">{row.source}</td>
                    <td className="px-2 py-2 text-right text-slate-100">{formatUsd(row.price ?? undefined)}</td>
                    <td className="px-2 py-2 text-right text-slate-300">{formatCompactUsd(row.volume24h ?? undefined)}</td>
                    <td className="px-2 py-2 text-right text-slate-300">{formatCompactUsd(row.marketCap ?? undefined)}</td>
                    <td className="px-2 py-2 text-right text-slate-300">{formatNumber(row.rsi14 ?? undefined)}</td>
                    <td className="px-2 py-2 text-right text-slate-300">{formatCompactUsd(row.tvl ?? undefined)}</td>
                    <td className="px-2 py-2 text-right text-slate-400">{formatRelative(row.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <SectionHeader title="Pipeline Live Feed" subtitle="WebSocket events from /offline namespace" />
        {offlineEvents.length === 0 ? (
          <Empty text="No live events yet." />
        ) : (
          <ul className="space-y-2 text-sm">
            {offlineEvents.slice(0, 8).map((event, idx) => (
              <li key={idx} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2">
                <span className="font-mono text-xs text-sky-300">{event.type}</span>
                <span className="text-xs text-slate-400">{formatRelative(event.timestamp)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
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

function ActionBadge({ action }: { action: string }) {
  const norm = action.toLowerCase();
  if (norm === "buy") return <span className="badge-green">BUY</span>;
  if (norm === "sell") return <span className="badge-red">SELL</span>;
  return <span className="badge-slate">{action.toUpperCase()}</span>;
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-4 text-center text-sm text-slate-400">{text}</p>;
}
