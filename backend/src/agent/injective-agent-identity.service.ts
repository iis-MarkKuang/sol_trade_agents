import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import {
  InjectiveRegistryReader,
  RawAgentData,
} from './injective-registry.viem';
import {
  AgentCardDto,
  AgentIdentityDto,
  AgentServiceEntry,
  RegistryAgentDto,
  RegistryListDto,
} from './injective-agent-identity.types';

/**
 * Injective Agent Identity (ERC-8004) service.
 *
 * - "Our agent" identity: by default a deterministic mock card so the demo
 *   always shows something; if INJECTIVE_AGENT_ID is set, fetches the real
 *   on-chain record via viem.
 * - Registry browse: when INJECTIVE_AGENT_REGISTRY_ENABLED=true, performs a
 *   bounded live scan of the Injective Identity Registry; otherwise returns
 *   clearly-labelled sample agents.
 *
 * Real on-chain *registration* (writing) needs the @injective/agent-sdk +
 * Pinata JWT and is intentionally left as a documented next step; the read
 * path is fully live today.
 */
@Injectable()
export class InjectiveAgentIdentityService {
  private readonly logger = new Logger(InjectiveAgentIdentityService.name);
  private reader?: InjectiveRegistryReader;

  constructor(private readonly configService: ConfigService) {}

  private getReader(): InjectiveRegistryReader {
    if (!this.reader) {
      const cfg = this.configService.agentIdentity;
      this.reader = new InjectiveRegistryReader(cfg.network);
    }
    return this.reader;
  }

  async getOurIdentity(): Promise<AgentIdentityDto> {
    const cfg = this.configService.agentIdentity;
    const services: AgentServiceEntry[] = [
      {
        type: 'MCP',
        endpoint: cfg.mcpPublicUrl,
        description: 'Cross-chain quant tools: query_nbbo, propose_arb, execute_injective, get_agent_identity',
      },
    ];
    if (cfg.a2aPublicUrl) {
      services.push({ type: 'A2A', endpoint: cfg.a2aPublicUrl, description: 'Agent-to-agent endpoint' });
    }

    const card: AgentCardDto = {
      name: cfg.name,
      description: cfg.description,
      type: cfg.type,
      builderCode: cfg.builderCode,
      x402: false,
      services,
      version: '0.1.0',
      tags: ['nova', 'cross-chain', 'arbitrage', 'solana', 'injective'],
      sourceCode: 'https://github.com/<you>/sol_trade_agent',
      documentation: 'https://github.com/<you>/sol_trade_agent#injective-integration-nova-program',
    };

    // Real path: a registered agentId was provided.
    if (cfg.agentId) {
      try {
        const reader = this.getReader();
        const id = BigInt(cfg.agentId);
        const data = await reader.getAgentById(id);
        if (data) {
          const fetchedCard = await this.fetchAgentCard(data.tokenUri);
          return {
            agentId: data.agentId.toString(),
            identityTuple: reader.identityTuple(data.agentId),
            name: fetchedCard?.name ?? cfg.name,
            type: data.agentType || cfg.type,
            builderCode: data.builderCode || cfg.builderCode,
            owner: data.owner,
            wallet: data.wallet,
            cardUri: data.tokenUri,
            scanUrl: reader.scanUrl(data.agentId),
            card: fetchedCard ?? card,
            registered: true,
            simulated: false,
            network: reader.config.name,
            chainId: reader.config.chainId,
            registry: reader.config.identityRegistry,
            mcpEndpoint: cfg.mcpPublicUrl,
          };
        }
        this.logger.warn(`INJECTIVE_AGENT_ID=${cfg.agentId} not found on registry; falling back to simulated identity`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Real identity lookup failed: ${msg}; falling back to simulated identity`);
      }
    }

    // Mock / simulated path.
    const simId = deterministicAgentId(cfg.builderCode, cfg.name);
    const reader = this.getReader();
    return {
      agentId: simId.toString(),
      identityTuple: reader.identityTuple(simId),
      name: cfg.name,
      type: cfg.type,
      builderCode: cfg.builderCode,
      cardUri: `ipfs://simulated/${simId}`,
      scanUrl: `https://agents.injective.com/agent/${simId}`,
      card,
      registered: false,
      simulated: true,
      network: reader.config.name,
      chainId: reader.config.chainId,
      registry: reader.config.identityRegistry,
      mcpEndpoint: cfg.mcpPublicUrl,
    };
  }

  async listRegistryAgents(offset = 0, limit = 20): Promise<RegistryListDto> {
    const cfg = this.configService.agentIdentity;
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const safeOffset = Math.max(offset, 0);

    if (cfg.registryEnabled) {
      try {
        const reader = this.getReader();
        const fromBlock = cfg.scanFromBlock ? BigInt(cfg.scanFromBlock) : undefined;
        const ids = await reader.discoverAgentIds({
          fromBlock,
          maxChunks: cfg.scanMaxChunks,
          chunkSize: cfg.scanChunkSize,
        });
        const total = ids.length;
        const pageIds = ids.slice(safeOffset, safeOffset + safeLimit);
        const enriched = await Promise.all(pageIds.map((id) => this.enrichRegistryAgent(id)));
        const agents = enriched.filter((a): a is RegistryAgentDto => a !== null);
        return {
          network: reader.config.name,
          total,
          offset: safeOffset,
          limit: safeLimit,
          agents,
          real: true,
          note:
            total === 0
              ? 'Live scan returned no agents in the configured block window. Widen INJECTIVE_AGENT_SCAN_MAX_CHUNKS or set INJECTIVE_AGENT_SCAN_FROM_BLOCK closer to a registration block.'
              : undefined,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Live registry scan failed: ${msg}; returning samples`);
        return this.mockRegistry(safeOffset, safeLimit, `Live registry unreachable (${msg}); showing sample agents.`);
      }
    }

    return this.mockRegistry(safeOffset, safeLimit, 'Registry browse is disabled (set INJECTIVE_AGENT_REGISTRY_ENABLED=true for a live scan). Showing sample agents.');
  }

  private async enrichRegistryAgent(id: bigint): Promise<RegistryAgentDto | null> {
    const reader = this.getReader();
    const data = await reader.getAgentById(id);
    if (!data) return null;
    const card = await this.fetchAgentCard(data.tokenUri);
    return this.toRegistryAgent(data, card, true);
  }

  private toRegistryAgent(
    data: RawAgentData,
    card: AgentCardDto | null | undefined,
    real: boolean,
  ): RegistryAgentDto {
    const reader = this.getReader();
    return {
      agentId: data.agentId.toString(),
      name: card?.name ?? `Agent #${data.agentId.toString()}`,
      type: data.agentType || 'other',
      owner: data.owner,
      wallet: data.wallet,
      builderCode: data.builderCode,
      tokenUri: data.tokenUri,
      identityTuple: reader.identityTuple(data.agentId),
      scanUrl: reader.scanUrl(data.agentId),
      card: card ?? null,
      real,
    };
  }

  /** Best-effort fetch of an Agent Card JSON from ipfs:// or https:// URIs. */
  private async fetchAgentCard(tokenUri: string): Promise<AgentCardDto | null> {
    if (!tokenUri) return null;
    const url = toGatewayUrl(tokenUri);
    if (!url) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const json = (await res.json()) as Partial<AgentCardDto> & { services?: unknown };
      if (!json || typeof json !== 'object') return null;
      const services = Array.isArray(json.services) ? (json.services as AgentServiceEntry[]) : [];
      return {
        name: typeof json.name === 'string' ? json.name : 'Unnamed Agent',
        description: typeof json.description === 'string' ? json.description : '',
        type: typeof json.type === 'string' ? json.type : 'other',
        builderCode: typeof json.builderCode === 'string' ? json.builderCode : '',
        image: typeof json.image === 'string' ? json.image : undefined,
        x402: Boolean(json.x402),
        services,
        version: typeof json.version === 'string' ? json.version : undefined,
        tags: Array.isArray(json.tags) ? (json.tags as string[]) : undefined,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private mockRegistry(offset: number, limit: number, note: string): RegistryListDto {
    const cfg = this.configService.agentIdentity;
    const reader = this.getReader();
    const samples = SAMPLE_AGENTS.map((s) => {
      const id = deterministicAgentId(cfg.builderCode, s.name);
      const data: RawAgentData = {
        agentId: id,
        owner: ('0x' + id.toString(16).padStart(40, '0')).slice(0, 42) as `0x${string}`,
        wallet: ('0x' + (id + 1n).toString(16).padStart(40, '0')).slice(0, 42) as `0x${string}`,
        tokenUri: `ipfs://simulated/${id}`,
        builderCode: s.builderCode,
        agentType: s.type,
      };
      const card: AgentCardDto = {
        name: s.name,
        description: s.description,
        type: s.type,
        builderCode: s.builderCode,
        x402: s.x402,
        services: s.services,
      };
      return this.toRegistryAgent(data, card, false);
    });
    return {
      network: reader.config.name,
      total: samples.length,
      offset,
      limit,
      agents: samples.slice(offset, offset + limit),
      real: false,
      note,
    };
  }
}

interface SampleAgent {
  name: string;
  type: string;
  builderCode: string;
  description: string;
  x402: boolean;
  services: AgentServiceEntry[];
}

const SAMPLE_AGENTS: SampleAgent[] = [
  {
    name: 'FundingRateSniper',
    type: 'trading',
    builderCode: 'nova-demo',
    description: 'Autonomous funding-rate arbitrage agent across Injective perp markets.',
    x402: true,
    services: [{ type: 'MCP', endpoint: 'https://demo.fundingrate.sniper/mcp' }],
  },
  {
    name: 'HelixMarketMaker',
    type: 'trading',
    builderCode: 'helix-labs',
    description: 'Provides liquidity on Helix spot markets with rebalancing via Peggy bridge.',
    x402: false,
    services: [{ type: 'A2A', endpoint: 'https://demo.helix.mm/a2a' }],
  },
  {
    name: 'PythOracleWatcher',
    type: 'data',
    builderCode: 'pyth-observer',
    description: 'Monitors Pyth price feeds and emits arbitrage signals to subscribed agents.',
    x402: false,
    services: [{ type: 'web', endpoint: 'https://demo.pyth.watcher/feed' }],
  },
  {
    name: 'DeBridgeRouter',
    type: 'portfolio',
    builderCode: 'debridge',
    description: 'Routes cross-chain settlements between Solana and Injective via deBridge.',
    x402: true,
    services: [{ type: 'MCP', endpoint: 'https://demo.debridge.router/mcp' }],
  },
];

function deterministicAgentId(builderCode: string, salt: string): bigint {
  let h = 5381n;
  const s = `${builderCode}::${salt}`;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33n) ^ BigInt(s.charCodeAt(i));
  }
  // keep it within a realistic uint256-ish range but small enough to look like an NFT id
  return (h & 0xffffffffffffn) + 1n;
}

function toGatewayUrl(tokenUri: string): string | null {
  if (tokenUri.startsWith('http://') || tokenUri.startsWith('https://')) return tokenUri;
  if (tokenUri.startsWith('ipfs://')) {
    const path = tokenUri.slice('ipfs://'.length);
    return `https://w3s.link/ipfs/${path}`;
  }
  return null;
}
