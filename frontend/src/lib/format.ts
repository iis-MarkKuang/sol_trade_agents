export function formatNumber(value: number | string | null | undefined, opts?: Intl.NumberFormatOptions): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
    ...(opts ?? {})
  }).format(numeric);
}

export function formatUsd(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: numeric < 1 ? 6 : 2
  }).format(numeric);
}

export function formatCompactUsd(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(numeric);
}

export function formatBps(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)} bps`;
}

export function formatRelative(input: string | number | Date): string {
  const ts = typeof input === "string" || typeof input === "number" ? new Date(input) : input;
  if (Number.isNaN(ts.getTime())) return "—";
  const diff = Date.now() - ts.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return ts.toLocaleString();
}

export function shortenAddress(value: string | null | undefined, prefix = 4, suffix = 4): string {
  if (!value) return "—";
  if (value.length <= prefix + suffix + 1) return value;
  return `${value.slice(0, prefix)}…${value.slice(-suffix)}`;
}
