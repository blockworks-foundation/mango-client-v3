import { PublicKey } from '@solana/web3.js';
import IDS from './ids.json';
import { zeroKey } from './utils';

export type Cluster = 'devnet' | 'mainnet' | 'localnet' | 'testnet';

export const msrmMints = {
  devnet: new PublicKey('8DJBo4bF4mHNxobjdax3BL9RMh5o71Jf8UiKsf5C5eVH'),
  mainnet: new PublicKey('MSRMcoVyrFxnSgo5uXwone5SKcGhT1KEJMFEkMEWf9L'),
  localnet: zeroKey,
  testnet: zeroKey,
};

export const mngoMints = {
  devnet: new PublicKey('Bb9bsTQa1bGEtQ5KagGkvSHyuLqDWumFUcRqFusFNJWC'),
  mainnet: new PublicKey('MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac'),
};

export interface OracleConfig {
  symbol: string;
  publicKey: PublicKey;
}

function oracleConfigFromJson(j: any) {
  return {
    ...j,
    publicKey: new PublicKey(j.publicKey),
  };
}

function oracleConfigToJson(o: OracleConfig): any {
  return {
    ...o,
    publicKey: o.publicKey.toBase58(),
  };
}

export interface SpotMarketConfig {
  name: string;
  publicKey: PublicKey;
  baseSymbol: string;
  baseDecimals: number;
  quoteDecimals: number;
  marketIndex: number;
  bidsKey: PublicKey;
  asksKey: PublicKey;
  eventsKey: PublicKey;
}

function spotMarketConfigFromJson(j: any) {
  return {
    ...j,
    publicKey: new PublicKey(j.publicKey),
    bidsKey: new PublicKey(j.bidsKey),
    asksKey: new PublicKey(j.asksKey),
    eventsKey: new PublicKey(j.eventsKey),
  };
}

function spotMarketConfigToJson(p: SpotMarketConfig): any {
  return {
    ...p,
    publicKey: p.publicKey.toBase58(),
    bidsKey: p.bidsKey.toBase58(),
    asksKey: p.asksKey.toBase58(),
    eventsKey: p.eventsKey.toBase58(),
  };
}

export interface PerpMarketConfig {
  name: string;
  publicKey: PublicKey;
  baseSymbol: string;
  baseDecimals: number;
  quoteDecimals: number;
  marketIndex: number;
  bidsKey: PublicKey;
  asksKey: PublicKey;
  eventsKey: PublicKey;
}

function perpMarketConfigFromJson(j: any) {
  return {
    ...j,
    publicKey: new PublicKey(j.publicKey),
    bidsKey: new PublicKey(j.bidsKey),
    asksKey: new PublicKey(j.asksKey),
    eventsKey: new PublicKey(j.eventsKey),
  };
}

function perpMarketConfigToJson(p: PerpMarketConfig): any {
  return {
    ...p,
    publicKey: p.publicKey.toBase58(),
    bidsKey: p.bidsKey.toBase58(),
    asksKey: p.asksKey.toBase58(),
    eventsKey: p.eventsKey.toBase58(),
  };
}

export interface TokenConfig {
  symbol: string;
  mintKey: PublicKey;
  decimals: number;
  rootKey: PublicKey;
  nodeKeys: PublicKey[];
}

function tokenConfigFromJson(j: any): TokenConfig {
  return {
    ...j,
    mintKey: new PublicKey(j.mintKey),
    rootKey: new PublicKey(j.rootKey),
    nodeKeys: j.nodeKeys.map((k) => new PublicKey(k)),
  } as TokenConfig;
}

function tokenConfigToJson(t: TokenConfig): any {
  return {
    ...t,
    mintKey: t.mintKey.toBase58(),
    rootKey: t.rootKey.toBase58(),
    nodeKeys: t.nodeKeys.map((k) => k.toBase58()),
  };
}

export interface GroupConfig {
  cluster: Cluster;
  name: string;
  quoteSymbol: string;
  publicKey: PublicKey;
  mangoProgramId: PublicKey;
  serumProgramId: PublicKey;
  oracles: OracleConfig[];
  perpMarkets: PerpMarketConfig[];
  spotMarkets: SpotMarketConfig[];
  tokens: TokenConfig[];
}

export function getMarketIndexBySymbol(group: GroupConfig, symbol: string) {
  return group.oracles.findIndex((o) => o.symbol === symbol);
}

export function getOracleBySymbol(group: GroupConfig, symbol: string) {
  return group.oracles.find((o) => o.symbol === symbol);
}

export function getPerpMarketByBaseSymbol(group: GroupConfig, symbol: string) {
  return group.perpMarkets.find((p) => p.baseSymbol === symbol);
}

export function getPerpMarketByIndex(
  group: GroupConfig,
  marketIndex: number,
): PerpMarketConfig | undefined {
  return group.perpMarkets.find((p) => p.marketIndex === marketIndex);
}

export function getSpotMarketByBaseSymbol(group: GroupConfig, symbol: string) {
  return group.spotMarkets.find((p) => p.baseSymbol === symbol);
}

export type MarketKind = 'spot' | 'perp';

export interface MarketConfig {
  kind: MarketKind;
  name: string;
  publicKey: PublicKey;
  baseSymbol: string;
  baseDecimals: number;
  quoteDecimals: number;
  marketIndex: number;
  bidsKey: PublicKey;
  asksKey: PublicKey;
  eventsKey: PublicKey;
}

export function getAllMarkets(group: GroupConfig) {
  const spotMarkets = group.spotMarkets.map<MarketConfig>((m) => ({
    kind: 'spot',
    ...m,
  }));
  const perpMarkets = group.perpMarkets.map<MarketConfig>((m) => ({
    kind: 'perp',
    ...m,
  }));
  return spotMarkets.concat(perpMarkets);
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

export function getMarketByPublicKey(
  group: GroupConfig,
  key: string | Buffer | PublicKey,
) {
  if (!(key instanceof PublicKey)) {
    key = new PublicKey(key);
  }
  const spot = group.spotMarkets.find((m) =>
    m.publicKey.equals(key as PublicKey),
  );
  if (spot) {
    return { kind: 'spot', ...spot } as MarketConfig;
  }
  const perp = group.perpMarkets.find((m) =>
    m.publicKey.equals(key as PublicKey),
  );
  if (perp) {
    return { kind: 'perp', ...perp } as MarketConfig;
  }
}

export function getTokenByMint(
  group: GroupConfig,
  mint: string | Buffer | PublicKey,
) {
  if (!(mint instanceof PublicKey)) {
    mint = new PublicKey(mint);
  }
  return group.tokens.find((t) => t.mintKey.equals(mint as PublicKey));
}

export function getTokenBySymbol(
  group: GroupConfig,
  symbol: string,
): TokenConfig {
  const tokenConfig = group.tokens.find((t) => t.symbol === symbol);
  if (tokenConfig === undefined) {
    throw new Error(`Unable to find symbol: ${symbol} in GroupConfig`);
  }
  return tokenConfig;
}

// export function getTokenBySymbol(group: GroupConfig, symbol: string) {
//   return group.tokens.find((t) => t.symbol === symbol);
// }

function groupConfigFromJson(j: any) {
  return {
    ...j,
    publicKey: new PublicKey(j.publicKey),
    mangoProgramId: new PublicKey(j.mangoProgramId),
    serumProgramId: new PublicKey(j.serumProgramId),
    oracles: j.oracles.map((o) => oracleConfigFromJson(o)),
    perpMarkets: j.perpMarkets.map((p) => perpMarketConfigFromJson(p)),
    spotMarkets: j.spotMarkets.map((p) => spotMarketConfigFromJson(p)),
    tokens: j.tokens.map((t) => tokenConfigFromJson(t)),
  } as GroupConfig;
}

function groupConfigToJson(g: GroupConfig): any {
  return {
    ...g,
    publicKey: g.publicKey.toBase58(),
    mangoProgramId: g.mangoProgramId.toBase58(),
    serumProgramId: g.serumProgramId.toBase58(),
    oracles: g.oracles.map((o) => oracleConfigToJson(o)),
    perpMarkets: g.perpMarkets.map((p) => perpMarketConfigToJson(p)),
    spotMarkets: g.spotMarkets.map((p) => spotMarketConfigToJson(p)),
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

  public getGroupWithName(name: string) {
    return this.groups.find((g) => g.name === name);
  }

  public storeGroup(group: GroupConfig) {
    const _group = this.getGroup(group.cluster, group.name);
    if (_group) {
      Object.assign(_group, group);
    } else {
      this.groups.unshift(group);
    }
  }
}

const staticConfig = new Config(IDS);
