import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { jsonReplacer } from '../utils/amounts.js';

export type TradeEventType =
  | 'trade.intent.received'
  | 'trade.plan.ready'
  | 'trade.plan.rejected'
  | 'trade.submitted'
  | 'trade.confirmed'
  | 'trade.failed'
  | 'trade.error';

export interface TradeEvent {
  type: TradeEventType;
  tradeId: string;
  intentId?: string;
  userPubkey?: string;
  pair: string;
  side: 'buy' | 'sell';
  timestamp: number;
  message?: string;
  data?: unknown;
}

export interface PriceEvent {
  type: 'price.update';
  symbol: string;
  price: number;
  confidenceBps: number;
  isStale: boolean;
  publishTime: number;
  receivedAt: number;
}

@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('Realtime WebSocket gateway initialised at /realtime');
  }

  handleConnection(@ConnectedSocket() client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
    client.emit('connected', { socketId: client.id, timestamp: Date.now() });
  }

  handleDisconnect(@ConnectedSocket() client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe.trade')
  handleSubscribeTrade(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { tradeId?: string },
  ) {
    if (payload?.tradeId) {
      const room = tradeRoom(payload.tradeId);
      client.join(room);
      this.logger.debug(`Client ${client.id} subscribed to ${room}`);
      return { ok: true, tradeId: payload.tradeId };
    }
    return { ok: false, error: 'tradeId required' };
  }

  @SubscribeMessage('unsubscribe.trade')
  handleUnsubscribeTrade(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { tradeId?: string },
  ) {
    if (payload?.tradeId) {
      client.leave(tradeRoom(payload.tradeId));
    }
    return { ok: true };
  }

  @SubscribeMessage('subscribe.prices')
  handleSubscribePrices(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { pairs?: string[] },
  ) {
    const pairs = payload?.pairs ?? [];
    for (const pair of pairs) {
      client.join(priceRoom(pair));
    }
    return { ok: true, pairs };
  }

  @SubscribeMessage('unsubscribe.prices')
  handleUnsubscribePrices(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { pairs?: string[] },
  ) {
    const pairs = payload?.pairs ?? [];
    for (const pair of pairs) {
      client.leave(priceRoom(pair));
    }
    return { ok: true, pairs };
  }

  emitTradeEvent(event: TradeEvent): void {
    const sanitized = sanitize(event);
    this.server?.to(tradeRoom(event.tradeId)).emit('trade.event', sanitized);
    this.server?.emit('trade.feed', sanitized);
  }

  emitPriceUpdate(event: PriceEvent): void {
    const sanitized = sanitize(event);
    this.server?.to(priceRoom(event.symbol)).emit('price.update', sanitized);
  }
}

function tradeRoom(tradeId: string): string {
  return `trade:${tradeId}`;
}

function priceRoom(symbol: string): string {
  return `price:${symbol.toUpperCase()}`;
}

function sanitize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, jsonReplacer)) as T;
}
