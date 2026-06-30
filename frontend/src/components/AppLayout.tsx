import { NavLink, Outlet } from "react-router-dom";
import clsx from "clsx";
import { useSocketStore } from "../lib/websocket";

const navItems = [
  { to: "/insights", label: "Insights", emoji: "📊" },
  { to: "/live", label: "Live Trading", emoji: "⚡" }
];

export function AppLayout() {
  const realtimeConnected = useSocketStore((state) => state.realtimeConnected);
  const offlineConnected = useSocketStore((state) => state.offlineConnected);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-accent text-lg font-bold text-white shadow-lg shadow-brand/30">
              S
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide text-slate-100">
                Solana Trade Agent
              </p>
              <p className="text-xs text-slate-400">Offline + Realtime nBBO Demo</p>
            </div>
          </div>

          <nav className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900/60 p-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  clsx(
                    "rounded-lg px-4 py-1.5 text-sm font-medium transition",
                    isActive
                      ? "bg-brand text-white shadow-md shadow-brand/30"
                      : "text-slate-300 hover:bg-slate-800/80"
                  )
                }
              >
                <span className="mr-1">{item.emoji}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="hidden items-center gap-4 text-xs md:flex">
            <ConnectionDot connected={realtimeConnected} label="Realtime WS" />
            <ConnectionDot connected={offlineConnected} label="Offline WS" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>

      <footer className="mx-auto max-w-7xl px-6 py-6 text-center text-xs text-slate-500">
        Built for the Solana Frontier Hackathon · Demo build
      </footer>
    </div>
  );
}

function ConnectionDot({ connected, label }: { connected: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-slate-400">
      <span
        className={clsx(
          "h-2 w-2 rounded-full",
          connected ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" : "bg-slate-600"
        )}
      />
      <span>{label}</span>
    </div>
  );
}
