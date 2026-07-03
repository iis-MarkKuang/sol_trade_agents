import {
  createPublicClient,
  http,
  parseAbiItem,
  decodeAbiParameters,
  parseAbiParameters,
  type Address,
} from 'viem';

/**
 * Read-only client for the Injective ERC-8004 Agent Identity Registry.
 *
 * We talk to the canonical IdentityRegistry contract directly via viem (no
 * signing) so we can browse real registered agents on testnet/mainnet without
 * depending on the (currently unpublished) @injective/agent-sdk package.
 *
 * Contract addresses + chain ids are copied from the official
 * InjectiveLabs/injective-agent-sdk `config.ts`.
 *
 * NOTE: the public client is typed as `any` intentionally — viem 2.5x's
 * `readContract`/`getContract` generics produce spurious `authorizationList`
 * type errors against custom ABIs. Runtime behaviour is unaffected.
 */

export interface RegistryNetworkConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  identityRegistry: Address;
  deployBlock: bigint;
}

export const REGISTRY_NETWORKS: Record<string, RegistryNetworkConfig> = {
  testnet: {
    name: 'testnet',
    chainId: 1439,
    rpcUrl: 'https://testnet.sentry.chain.json-rpc.injective.network',
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    deployBlock: 120_790_000n,
  },
  mainnet: {
    name: 'mainnet',
    chainId: 1776,
    rpcUrl: 'https://sentry.evm-rpc.injective.network/',
    identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    deployBlock: 162_000_000n,
  },
};

const IDENTITY_REGISTRY_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'from', type: 'address' },
      { indexed: true, internalType: 'address', name: 'to', type: 'address' },
      { indexed: true, internalType: 'uint256', name: 'tokenId', type: 'uint256' },
    ],
    name: 'Transfer',
    type: 'event',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    name: 'getAgentWallet',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'string', name: 'metadataKey', type: 'string' },
    ],
    name: 'getMetadata',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'tokenURI',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
);

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

export interface RawAgentData {
  agentId: bigint;
  owner: Address;
  tokenUri: string;
  wallet: Address;
  builderCode: string;
  agentType: string;
}

function decodeStringMetadata(bytes: `0x${string}`): string {
  if (!bytes || bytes === '0x') return '';
  try {
    const [value] = decodeAbiParameters(parseAbiParameters('string'), bytes);
    return value ?? '';
  } catch {
    return '';
  }
}

export class InjectiveRegistryReader {
  readonly config: RegistryNetworkConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly publicClient: any;

  constructor(network: string, rpcUrlOverride?: string) {
    const base = REGISTRY_NETWORKS[network] ?? REGISTRY_NETWORKS.testnet;
    this.config = rpcUrlOverride ? { ...base, rpcUrl: rpcUrlOverride } : base;
    this.publicClient = createPublicClient({
      chain: {
        id: this.config.chainId,
        name: this.config.name,
        nativeCurrency: { name: 'INJ', symbol: 'INJ', decimals: 18 },
        rpcUrls: { default: { http: [this.config.rpcUrl] } },
      },
      transport: http(this.config.rpcUrl, { timeout: 15_000 }),
    });
  }

  identityTuple(agentId: bigint): string {
    return `eip155:${this.config.chainId}:${this.config.identityRegistry.toLowerCase()}:${agentId.toString()}`;
  }

  scanUrl(agentId: bigint): string {
    // Per-agent detail page on the official Injective Agent Registry.
    // Confirmed path: /registry/{tokenId}  (NOT /agent/{id}, which 404s).
    return `https://agents.injective.com/registry/${agentId.toString()}`;
  }

  async getAgentById(agentId: bigint): Promise<RawAgentData | null> {
    const args = { address: this.config.identityRegistry, abi: IDENTITY_REGISTRY_ABI } as const;
    try {
      const [owner, tokenUri, wallet, builderCodeRaw, typeRaw] = await Promise.all([
        this.publicClient.readContract({ ...args, functionName: 'ownerOf', args: [agentId] }),
        this.publicClient.readContract({ ...args, functionName: 'tokenURI', args: [agentId] }),
        this.publicClient.readContract({ ...args, functionName: 'getAgentWallet', args: [agentId] }),
        this.publicClient.readContract({ ...args, functionName: 'getMetadata', args: [agentId, 'builderCode'] }),
        this.publicClient.readContract({ ...args, functionName: 'getMetadata', args: [agentId, 'agentType'] }),
      ]);
      if (!owner || owner.toLowerCase() === ZERO_ADDRESS) return null;
      return {
        agentId,
        owner,
        tokenUri,
        wallet,
        builderCode: decodeStringMetadata(builderCodeRaw),
        agentType: decodeStringMetadata(typeRaw),
      };
    } catch {
      return null;
    }
  }

  /**
   * Bounded scan of Transfer events to discover minted agent ids.
   * Scans at most `maxChunks` blocks of `chunkSize` from `fromBlock` upward.
   * Burns (Transfer to 0x0) are removed from the live set.
   */
  async discoverAgentIds(opts: {
    fromBlock?: bigint;
    maxChunks: number;
    chunkSize: number;
  }): Promise<bigint[]> {
    const fromBlock = opts.fromBlock ?? this.config.deployBlock;
    const latest = await this.publicClient.getBlockNumber();
    const minted = new Set<bigint>();
    const burned = new Set<bigint>();
    let chunkErrors = 0;

    for (let i = 0; i < opts.maxChunks; i++) {
      const chunkStart = fromBlock + BigInt(i) * BigInt(opts.chunkSize);
      const chunkEnd = chunkStart + BigInt(opts.chunkSize) - 1n;
      const cappedTo = chunkEnd > latest ? latest : chunkEnd;
      try {
        const logs = await this.publicClient.getLogs({
          address: this.config.identityRegistry,
          event: TRANSFER_EVENT,
          fromBlock: chunkStart,
          toBlock: cappedTo,
        });
        for (const log of logs) {
          const a = log.args as { from?: Address; to?: Address; tokenId?: bigint };
          if (!a?.tokenId) continue;
          if (a.to && a.to.toLowerCase() === ZERO_ADDRESS) {
            burned.add(a.tokenId);
          } else {
            minted.add(a.tokenId);
          }
        }
      } catch (err) {
        // Range too large / node limit — viem getLogs rejected this chunk.
        // Surface once so misconfigured chunk sizes (e.g. mainnet sentry caps at
        // 10k blocks) are diagnosable instead of silently yielding 0 agents.
        if (chunkErrors === 0) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[InjectiveRegistryReader] getLogs chunk failed at block ${chunkStart.toString()} (chunkSize=${opts.chunkSize}); ` +
              `reducing INJECTIVE_AGENT_SCAN_CHUNK_SIZE may help. First error: ${msg.slice(0, 120)}`,
          );
        }
        chunkErrors++;
      }
      if (cappedTo >= latest) break;
    }

    for (const id of burned) minted.delete(id);
    return [...minted].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
}
