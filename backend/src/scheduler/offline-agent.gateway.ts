import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { PipelineSummary } from './offline-agent.service';

export type OfflineAgentEvent =
  | { type: 'pipeline.started'; timestamp: number }
  | { type: 'pipeline.completed'; timestamp: number; summary: PipelineSummary }
  | { type: 'pipeline.failed'; timestamp: number; message: string };

@WebSocketGateway({
  namespace: '/offline',
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  },
})
export class OfflineAgentGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(OfflineAgentGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit(): void {
    this.logger.log('Offline agent WebSocket gateway initialised at /offline');
  }

  handleConnection(@ConnectedSocket() client: Socket): void {
    client.emit('connected', { socketId: client.id, timestamp: Date.now() });
  }

  emit(event: OfflineAgentEvent): void {
    this.server?.emit('pipeline.event', event);
  }
}
