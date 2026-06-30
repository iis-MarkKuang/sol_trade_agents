/**
 * DTOs for the Injective Agent Identity (ERC-8004) layer.
 *
 * bigints are serialized as strings so they survive JSON over REST/WS/MCP.
 */

export interface AgentServiceEntry {
  type: 'MCP' | 'A2A' | 'web' | string;
  endpoint: string;
  description?: string;
}

export interface AgentCardDto {
  name: string;
  description: string;
  type: string;
  builderCode: string;
  image?: string;
  x402: boolean;
  services: AgentServiceEntry[];
  version?: string;
  tags?: string[];
  sourceCode?: string;
  documentation?: string;
}

export interface AgentIdentityDto {
  /** bigint as decimal string */
  agentId: string;
  identityTuple: string;
  name: string;
  type: string;
  builderCode: string;
  owner?: string;
  wallet?: string;
  cardUri: string;
  scanUrl: string;
  card: AgentCardDto;
  /** true when this identity actually exists on the Injective registry */
  registered: boolean;
  /** true when produced by the mock provider (no chain interaction) */
  simulated: boolean;
  network: string;
  chainId: number;
  registry: string;
  /** The MCP endpoint this agent exposes (declared in its Agent Card) */
  mcpEndpoint: string;
}

export interface RegistryAgentDto {
  agentId: string;
  name: string;
  type: string;
  owner: string;
  wallet: string;
  builderCode: string;
  tokenUri: string;
  identityTuple: string;
  scanUrl: string;
  /** Agent Card fetched from IPFS, if reachable */
  card?: AgentCardDto | null;
  real: boolean;
}

export interface RegistryListDto {
  network: string;
  total: number;
  offset: number;
  limit: number;
  agents: RegistryAgentDto[];
  /** true when the list came from a live registry scan */
  real: boolean;
  note?: string;
}
