import { PublicKey } from '@solana/web3.js';
import IDS from './ids.json';

export type Cluster = 'devnet' | 'mainnet-beta' | 'localnet' | 'testnet';

export interface OracleConfig {
  symbol: string;
  key: PublicKey;
}

function oracleConfigFromJson(j: any) {
  return {
    ...j,
    key: new PublicKey(j.key),
  };
}

function oracleConfigToJson(o: OracleConfig): any {
  return {
    ...o,
    key: o.key.toBase58(),
  };
}

export interface SpotMarketConfig {
  name: string;
  key: PublicKey;
  base_symbol: string;
  market_index: number;
}

function spotMarketConfigFromJson(j: any) {
  return {
    ...j,
    key: new PublicKey(j.key),
  };
}

function spotMarketConfigToJson(p: SpotMarketConfig): any {
  return {
    ...p,
    key: p.key.toBase58(),
  };
}

export interface PerpMarketConfig {
  name: string;
  key: PublicKey;
  base_symbol: string;
  market_index: number;
}

function perpMarketConfigFromJson(j: any) {
  return {
    ...j,
    key: new PublicKey(j.key),
  };
}

function perpMarketConfigToJson(p: PerpMarketConfig): any {
  return {
    ...p,
    key: p.key.toBase58(),
  };
}

export interface TokenConfig {
  symbol: string;
  mint_key: PublicKey;
  decimals: number;
  root_key: PublicKey;
  node_keys: PublicKey[];
}

function tokenConfigFromJson(j: any): TokenConfig {
  return {
    ...j,
    mint_key: new PublicKey(j.mint_key),
    root_key: new PublicKey(j.root_key),
    node_keys: j.node_keys.map((k) => new PublicKey(k)),
  } as TokenConfig;
}

function tokenConfigToJson(t: TokenConfig): any {
  return {
    ...t,
    mint_key: t.mint_key.toBase58(),
    root_key: t.root_key.toBase58(),
    node_keys: t.node_keys.map((k) => k.toBase58()),
  };
}

export interface GroupConfig {
  cluster: Cluster;
  name: string;
  quote_symbol: string;
  key: PublicKey;
  merps_program_id: PublicKey;
  serum_program_id: PublicKey;
  oracles: OracleConfig[];
  perp_markets: PerpMarketConfig[];
  spot_markets: SpotMarketConfig[];
  tokens: TokenConfig[];
}

export function getMarketIndexBySymbol(group: GroupConfig, symbol: string) {
  return group.oracles.findIndex((o) => o.symbol === symbol);
}

export function getOracleBySymbol(group: GroupConfig, symbol: string) {
  return group.oracles.find((o) => o.symbol === symbol);
}

export function getPerpMarketByBaseSymbol(group: GroupConfig, symbol: string) {
  return group.perp_markets.find((p) => p.base_symbol === symbol);
}

export function getSpotMarketByBaseSymbol(group: GroupConfig, symbol: string) {
  return group.spot_markets.find((p) => p.base_symbol === symbol);
}

export type MarketKind = 'spot' | 'perp';

export interface MarketConfig {
  kind: MarketKind;
  name: string;
  key: PublicKey;
  base_symbol: string;
  market_index: number;
}

export function getMarketByBaseSymbolAndKind(
  group: GroupConfig,
  symbol: string,
  kind: MarketKind,
) {
  const market =
    kind === 'spot'
      ? getSpotMarketByBaseSymbol(group, symbol)
      : getPerpMarketByBaseSymbol(group, symbol);
  return { kind, ...market } as MarketConfig;
}

export function getTokenByMint(group: GroupConfig, mint: string | PublicKey) {
  if (mint instanceof PublicKey) {
    mint = mint.toBase58();
  }
  return group.tokens.find((t) => t.mint_key.toBase58() === mint);
}

export function getTokenBySymbol(group: GroupConfig, symbol: string) {
  return group.tokens.find((t) => t.symbol === symbol);
}

function groupConfigFromJson(j: any) {
  return {
    ...j,
    key: new PublicKey(j.key),
    merps_program_id: new PublicKey(j.merps_program_id),
    serum_program_id: new PublicKey(j.serum_program_id),
    oracles: j.oracles.map((o) => oracleConfigFromJson(o)),
    perp_markets: j.perp_markets.map((p) => perpMarketConfigFromJson(p)),
    spot_markets: j.spot_markets.map((p) => spotMarketConfigFromJson(p)),
    tokens: j.tokens.map((t) => tokenConfigFromJson(t)),
  } as GroupConfig;
}

function groupConfigToJson(g: GroupConfig): any {
  return {
    ...g,
    key: g.key.toBase58(),
    merps_program_id: g.merps_program_id.toBase58(),
    serum_program_id: g.serum_program_id.toBase58(),
    oracles: g.oracles.map((o) => oracleConfigToJson(o)),
    perp_markets: g.perp_markets.map((p) => perpMarketConfigToJson(p)),
    spot_markets: g.spot_markets.map((p) => spotMarketConfigToJson(p)),
    tokens: g.tokens.map((t) => tokenConfigToJson(t)),
  };
}

export class Config {
  public cluster_urls: Record<Cluster, string>;
  public groups: GroupConfig[];

  constructor(json: any) {
    this.cluster_urls = json.cluster_urls;
    this.groups = json.groups.map((g) => groupConfigFromJson(g));
  }

  public static ids() {
    return staticConfig;
  }

  public toJson(): any {
    return {
      ...this,
      groups: this.groups.map((g) => groupConfigToJson(g)),
    };
  }

  public getGroup(cluster: Cluster, name: string) {
    return this.groups.find((g) => g.cluster === cluster && g.name === name);
  }

  public storeGroup(group: GroupConfig) {
    const _group = this.getGroup(group.cluster, group.name);
    if (_group) {
      Object.assign(_group, group);
    } else {
      this.groups.push(group);
    }
  }
}

const staticConfig = new Config(IDS);
