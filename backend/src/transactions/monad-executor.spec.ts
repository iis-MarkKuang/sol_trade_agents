import {
  MonadViemExecutor,
  MockMonadTradeExecutor,
  type MonadTradeRequest,
} from './monad-executor.js';
import type { MonadExecutionPlan, TradeIntent } from '../types.js';

const THROWAWAY_KEY =
  '0x0000000000000000000000000000000000000000000000000000000000000001' as const;

function makePlan(overrides: Partial<MonadExecutionPlan> = {}): MonadExecutionPlan {
  return {
    chainId: 143,
    dex: '0x',
    tokenIn: '0xIN',
    tokenOut: '0xOUT',
    side: 'buy',
    amountIn: '1.0',
    minAmountOut: '0.9',
    to: '0xRECIPIENT',
    deadline: Math.floor(Date.now() / 1000) + 600,
    notionalUsd: 1000,
    reason: 'test',
    ...overrides,
  };
}

function makeRequest(plan: MonadExecutionPlan, options?: Record<string, unknown>): MonadTradeRequest {
  const intent: TradeIntent = {
    pair: 'WBTC/USDC',
    side: 'buy',
    amountIn: 1_000_000n,
    maxSlippageBps: 100,
  };
  return { plan, intent, options };
}

describe('MockMonadTradeExecutor', () => {
  it('is always available', async () => {
    const exec = new MockMonadTradeExecutor();
    expect(await exec.isAvailable()).toBe(true);
  });

  it('returns a simulated tx hash with mock_monad_ prefix', async () => {
    const exec = new MockMonadTradeExecutor();
    const result = await exec.executeTrade(makeRequest(makePlan()));
    expect(result.status).toBe('simulated');
    expect(result.txHash).toMatch(/^mock_monad_/);
    expect(result.message).toContain('chain 143');
  });
});

describe('MonadViemExecutor', () => {
  it('is not available when no private key is configured', async () => {
    const exec = new MonadViemExecutor({
      rpcUrl: 'https://rpc.monad.xyz',
      network: 'mainnet',
    });
    expect(await exec.isAvailable()).toBe(false);
  });

  it('is available when a valid private key is configured', async () => {
    const exec = new MonadViemExecutor({
      rpcUrl: 'https://rpc.monad.xyz',
      network: 'mainnet',
      privateKey: THROWAWAY_KEY,
    });
    expect(await exec.isAvailable()).toBe(true);
  });

  it('returns failed when no key is set and executeTrade is called', async () => {
    const exec = new MonadViemExecutor({
      rpcUrl: 'https://rpc.monad.xyz',
      network: 'mainnet',
    });
    const result = await exec.executeTrade(makeRequest(makePlan()));
    expect(result.status).toBe('failed');
    expect(result.message).toContain('no private key');
  });

  it('simulates when calldata is not supplied (demo path)', async () => {
    const exec = new MonadViemExecutor({
      rpcUrl: 'https://rpc.monad.xyz',
      network: 'mainnet',
      privateKey: THROWAWAY_KEY,
    });
    const result = await exec.executeTrade(makeRequest(makePlan()));
    expect(result.status).toBe('simulated');
    expect(result.txHash).toMatch(/^sim_monad_/);
  });

  it('submits a transaction when calldata is supplied (mocked sendTransaction)', async () => {
    const exec = new MonadViemExecutor({
      rpcUrl: 'https://rpc.monad.xyz',
      network: 'mainnet',
      privateKey: THROWAWAY_KEY,
    });
    // Replace sendTransaction on the internal wallet client with a mock.
    const client = (exec as unknown as { client: { sendTransaction: (...args: unknown[]) => unknown } }).client;
    const sendTx = jest.fn().mockResolvedValue('0xREALTXHASH');
    client.sendTransaction = sendTx;

    const result = await exec.executeTrade(
      makeRequest(makePlan(), { to: '0xROUTER', data: '0xcalldata', value: '0' }),
    );

    expect(result.status).toBe('submitted');
    expect(result.txHash).toBe('0xREALTXHASH');
    expect(sendTx).toHaveBeenCalled();
  });

  it('returns failed on a broadcast error instead of throwing', async () => {
    const exec = new MonadViemExecutor({
      rpcUrl: 'https://rpc.monad.xyz',
      network: 'mainnet',
      privateKey: THROWAWAY_KEY,
    });
    const client = (exec as unknown as { client: { sendTransaction: (...args: unknown[]) => unknown } }).client;
    client.sendTransaction = jest.fn().mockRejectedValue(new Error('nonce too low'));

    const result = await exec.executeTrade(
      makeRequest(makePlan(), { to: '0xROUTER', data: '0xcalldata' }),
    );

    expect(result.status).toBe('failed');
    expect(result.message).toContain('nonce too low');
  });
});
