import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Solana Frontier Web3 LLM Trading Agent Backend';
  }
}
