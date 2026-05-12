import { io, type Socket } from "socket.io-client";
import { create } from "zustand";

const wsBase = import.meta.env.VITE_WS_URL || window.location.origin;

export type TradeEventType =
  | "trade.intent.received"
  | "trade.plan.ready"
  | "trade.plan.rejected"
  | "trade.submitted"
  | "trade.confirmed"
  | "trade.failed"
  | "trade.error";

export interface TradeEvent {
  type: TradeEventType;
  tradeId: string;
  intentId?: string;
  userPubkey?: string;
  pair: string;
  side: "buy" | "sell";
  timestamp: number;
  message?: string;
  data?: unknown;
}

export interface PriceEvent {
  type: "price.update";
  symbol: string;
  price: number;
  confidenceBps: number;
  isStale: boolean;
  publishTime: number;
  receivedAt: number;
}

export type OfflineEvent =
  | { type: "pipeline.started"; timestamp: number }
  | { type: "pipeline.completed"; timestamp: number; summary: unknown }
  | { type: "pipeline.failed"; timestamp: number; message: string };

interface SocketStoreState {
  realtimeConnected: boolean;
  offlineConnected: boolean;
  tradeEvents: TradeEvent[];
  prices: Record<string, PriceEvent>;
  offlineEvents: OfflineEvent[];
  connect: () => void;
  disconnect: () => void;
  reset: () => void;
}

let realtimeSocket: Socket | null = null;
let offlineSocket: Socket | null = null;

const MAX_TRADE_EVENTS = 50;
const MAX_OFFLINE_EVENTS = 30;

export const useSocketStore = create<SocketStoreState>((set, get) => ({
  realtimeConnected: false,
  offlineConnected: false,
  tradeEvents: [],
  prices: {},
  offlineEvents: [],

  connect: () => {
    if (realtimeSocket && offlineSocket) return;

    realtimeSocket = io(`${wsBase}/realtime`, {
      transports: ["websocket"],
      reconnection: true
    });
    realtimeSocket.on("connect", () => set({ realtimeConnected: true }));
    realtimeSocket.on("disconnect", () => set({ realtimeConnected: false }));
    realtimeSocket.on("trade.feed", (event: TradeEvent) => {
      set((state) => ({
        tradeEvents: [event, ...state.tradeEvents].slice(0, MAX_TRADE_EVENTS)
      }));
    });
    realtimeSocket.on("price.update", (event: PriceEvent) => {
      set((state) => ({ prices: { ...state.prices, [event.symbol]: event } }));
    });

    offlineSocket = io(`${wsBase}/offline`, {
      transports: ["websocket"],
      reconnection: true
    });
    offlineSocket.on("connect", () => set({ offlineConnected: true }));
    offlineSocket.on("disconnect", () => set({ offlineConnected: false }));
    offlineSocket.on("pipeline.event", (event: OfflineEvent) => {
      set((state) => ({
        offlineEvents: [event, ...state.offlineEvents].slice(0, MAX_OFFLINE_EVENTS)
      }));
    });
  },

  disconnect: () => {
    realtimeSocket?.disconnect();
    offlineSocket?.disconnect();
    realtimeSocket = null;
    offlineSocket = null;
    set({ realtimeConnected: false, offlineConnected: false });
  },

  reset: () => set({ tradeEvents: [], prices: {}, offlineEvents: [] })
}));

export function subscribeToPrices(pairs: string[]): void {
  realtimeSocket?.emit("subscribe.prices", { pairs });
}

export function subscribeToTrade(tradeId: string): void {
  realtimeSocket?.emit("subscribe.trade", { tradeId });
}
