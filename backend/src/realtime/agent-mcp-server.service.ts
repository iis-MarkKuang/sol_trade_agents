import { Injectable, Logger } from '@nestjs/common';
import { RealtimeService } from './realtime.service';
import { InjectiveAgentIdentityService } from '../agent/injective-agent-identity.service';

/**
 * Exposes our cross-chain quant agent as a standards-compliant MCP server
 * (Streamable HTTP transport) at POST /mcp.
 *
 * The @modelcontextprotocol/sdk is ESM-only, so we dynamic-import it lazily
 * on the first request (works from our CommonJS NestJS build). We use the
 * stateless pattern from the SDK's examples: a fresh McpServer per request,
 * sessionIdGenerator: undefined.
 *
 * Tools published to the Injective Agent Registry via our Agent Card:
 *   - query_cross_chain_nbbo   live nBBO for a pair
 *   - propose_arb_plan          cross-chain arbitrage scan
 *   - execute_injective_trade   prepare + execute an Injective (Helix) trade
 *   - get_agent_identity        our ERC-8004 identity card
 */
@Injectable()
export class AgentMcpServerService {
  private readonly logger = new Logger(AgentMcpServerService.name);
  private sdkPromise?: Promise<{
    McpServer: any;
    StreamableHTTPServerTransport: any;
    z: any;
  }>;

  constructor(
    private readonly realtime: RealtimeService,
    private readonly identity: InjectiveAgentIdentityService,
  ) {}

  private async getSdk() {
    if (!this.sdkPromise) {
      this.sdkPromise = (async () => {
        const mcp = (await import('@modelcontextprotocol/sdk/server/mcp.js')) as any;
        const transport = (await import(
          '@modelcontextprotocol/sdk/server/streamableHttp.js'
        )) as any;
        const z = (await import('zod/v4')) as any;
        return {
          McpServer: mcp.McpServer,
          StreamableHTTPServerTransport: transport.StreamableHTTPServerTransport,
          z,
        };
      })();
    }
    return this.sdkPromise;
  }

  /** Handle a single stateless MCP HTTP request (POST /mcp). */
  async handlePost(req: any, res: any, body: unknown): Promise<void> {
    const { McpServer, StreamableHTTPServerTransport, z } = await this.getSdk();

    const server = new McpServer(
      { name: 'sol-trade-cross-chain-agent', version: '0.1.0' },
      { capabilities: { logging: {} } },
    );

    this.registerTools(server, z);

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);

    try {
      await transport.handleRequest(req, res, body ?? req.body);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`MCP handleRequest failed: ${msg}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    } finally {
      res.on('close', () => {
        transport.close();
        server.close();
      });
    }
  }

  private registerTools(server: any, z: any) {
    server.registerTool(
      'query_cross_chain_nbbo',
      {
        description:
          'Get the live cross-chain National Best Bid/Offer for a trading pair across Solana DEXs and Injective Helix.',
        inputSchema: {
          pair: z.string().optional().describe('Pair symbol, e.g. "SOL/USDC", "BTC/USDT". Defaults to SOL/USDC.'),
        },
      },
      async ({ pair }: { pair?: string }) => {
        const snapshot = await this.realtime.getMarketNbbo({ pair: pair ?? 'SOL/USDC' });
        return { content: [{ type: 'text', text: JSON.stringify(snapshot, jsonReplacer) }] };
      },
    );

    server.registerTool(
      'propose_arb_plan',
      {
        description:
          'Scan for cross-chain arbitrage opportunities (Solana <-> Injective) for shared assets (BTC, ETH) and propose a buy-low/sell-high plan.',
        inputSchema: {
          assets: z
            .string()
            .optional()
            .describe('Comma-separated asset symbols, e.g. "BTC,ETH". Defaults to BTC,ETH.'),
        },
      },
      async ({ assets }: { assets?: string }) => {
        const list = assets ? assets.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
        const result = await this.realtime.getCrossChainArb({ assets: list });
        const summary =
          result.signals.length === 0
            ? 'No profitable cross-chain arbitrage found at the moment (spreads below threshold + bridge cost).'
            : result.signals
                .map(
                  (s: any) =>
                    `${s.asset}: buy ${s.buyChain} @ ${s.buyPrice} / sell ${s.sellChain} @ ${s.sellPrice} — net edge ${s.netEdgeBps} bps`,
                )
                .join('\n');
        return {
          content: [
            { type: 'text', text: summary },
            { type: 'text', text: JSON.stringify(result, jsonReplacer) },
          ],
        };
      },
    );

    server.registerTool(
      'execute_injective_trade',
      {
        description:
          'Prepare and execute a trade on Injective Helix via the official Injective MCP server. Use for spot/perp orders on Injective markets (e.g. INJ/USDC, BTC/USDT).',
        inputSchema: {
          pair: z.string().min(3).describe('Injective pair symbol, e.g. "INJ/USDC", "BTC/USDT".'),
          side: z.enum(['buy', 'sell']),
          amountIn: z.string().describe('Input amount as a decimal string.'),
        },
      },
      async ({ pair, side, amountIn }: { pair: string; side: 'buy' | 'sell'; amountIn: string }) => {
        try {
          const prepared = await this.realtime.prepareTrade({ pair, side, amountIn });
          const plan = prepared.plan as any;
          if (plan?.injectiveExecutionPlan) {
            const executed = await this.realtime.executeInjectiveTrade({ tradeId: prepared.tradeId });
            return {
              content: [
                {
                  type: 'text',
                  text: `Injective trade executed: ${side} ${pair} via MCP. Status: ${executed.status}`,
                },
                { type: 'text', text: JSON.stringify(executed, jsonReplacer) },
              ],
            };
          }
          return {
            content: [
              { type: 'text', text: `Trade prepared on ${plan?.chain ?? 'solana'} (no Injective execution plan).` },
              { type: 'text', text: JSON.stringify({ tradeId: prepared.tradeId, plan }, jsonReplacer) },
            ],
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { content: [{ type: 'text', text: `execute_injective_trade failed: ${msg}` }] };
        }
      },
    );

    server.registerTool(
      'get_agent_identity',
      {
        description:
          'Return this agent\'s ERC-8004 Injective Agent Identity card (name, builderCode, services, scan URL).',
        inputSchema: {},
      },
      async () => {
        const card = await this.identity.getOurIdentity();
        return { content: [{ type: 'text', text: JSON.stringify(card, jsonReplacer) }] };
      },
    );
  }
}

/** JSON replacer that stringifies bigints (viem/Pyth amounts). */
function jsonReplacer(_k: string, v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString();
  return v;
}
