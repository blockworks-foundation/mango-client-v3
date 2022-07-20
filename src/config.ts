import { PublicKey } from '@solana/web3.js';
import IDS from './ids.json';
import { zeroKey } from './utils/utils';

export type Cluster = 'devnet' | 'mainnet' | 'localnet' | 'testnet';

export const msrmMints = {
  devnet: new PublicKey('8DJBo4bF4mHNxobjdax3BL9RMh5o71Jf8UiKsf5C5eVH'),
  mainnet: new PublicKey('MSRMcoVyrFxnSgo5uXwone5SKcGhT1KEJMFEkMEWf9L'),
  localnet: zeroKey,
  testnet: new PublicKey('3Ho7PN3bYv9bp1JDErBD2FxsRepPkL88vju3oDX9c3Ez'),
};

export const mngoMints = {
  devnet: new PublicKey('Bb9bsTQa1bGEtQ5KagGkvSHyuLqDWumFUcRqFusFNJWC'),
  mainnet: new PublicKey('MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac'),
  testnet: new PublicKey('2hvukwp4UR9tqmCQhRzcsW9S2QBuU5Xcv5JJ5fUMmfvQ'),
};

export const delistedSpotMarkets = [
  { publicKey: new PublicKey('HBTu8hNaoT3VyiSSzJYa8jwt9sDGKtJviSwFa11iXdmE'), name: 'LUNA/USDC', baseSymbol: 'LUNA', baseDecimals: 6, marketIndex: 13 },
  { publicKey: new PublicKey('6fc7v3PmjZG9Lk2XTot6BywGyYLkBQuzuFKd4FpCsPxk'), name: 'COPE/USDC',  baseSymbol: 'COPE', baseDecimals: 6, marketIndex: 7 },
  { publicKey: new PublicKey('3zzTxtDCt9PimwzGrgWJEbxZfSLetDMkdYegPanGNpMf'), name: 'BNB/USDC', baseSymbol: 'BNB', baseDecimals: 8, marketIndex: 11}
];

export const delistedPerpMarkets = [
  { publicKey: new PublicKey('BCJrpvsB2BJtqiDgKVC4N6gyX1y24Jz96C6wMraYmXss'), name: 'LUNA-PERP', baseSymbol: 'LUNA', baseDecimals: 6, quoteDecimals: 6, marketIndex: 13 },
];

export const delistedTokens = [
  { mintKey: new PublicKey('F6v4wfAdJB8D8p77bMXZgYt8TDKsYxLYxH5AFhUkYx9W'), symbol: 'LUNA', decimals: 6 },
  { mintKey: new PublicKey('8HGyAAB1yoM1ttS7pXjHMa3dukTFGQggnFFH3hJZgzQh'), symbol: 'COPE', decimals: 6 },
];

export const delistedOracles = [
  { publicKey: new PublicKey('5bmWuR1dgP4avtGYMNKLuxumZTVKGgoN2BCMXWDNL9nY'), symbol: 'LUNA', marketIndex: 13 },
  { publicKey: new PublicKey('9xYBiDWYsh2fHzpsz3aaCnNHCKWBNtfEDLtU6kS4aFD9'), symbol: 'COPE', marketIndex: 7 },
]

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

export function getSpotMarketConfig(group: GroupConfig, predicate) {
  let config = group.spotMarkets.find(predicate);

  if (!config) {
    config = (delistedSpotMarkets.find(predicate)) as SpotMarketConfig | undefined;
  }

  return config;
}

export function getPerpMarketConfig(group: GroupConfig, predicate) {
  let config = group.perpMarkets.find(predicate);

  if (!config) {
    config = (delistedPerpMarkets.find(predicate)) as PerpMarketConfig | undefined;
  }

  return config;
}

export function getTokenConfig(group: GroupConfig, predicate) {
  let config = group.tokens.find(predicate);

  if (!config) {
    config = (delistedTokens.find(predicate)) as TokenConfig | undefined;
  }

  return config;
}

export function getOracleConfig(group: GroupConfig, predicate) {
  let config = group.oracles.find(predicate);

  if (!config) {
    config = (delistedOracles.find(predicate)) as OracleConfig | undefined;
  }

  return config;
}

export function getMarketIndexBySymbol(group: GroupConfig, symbol: string) {
  let index = group.oracles.findIndex((o) => o.symbol === symbol)

  if (index === -1) {
    const delistedOracle = getOracleConfig(group, (o) => o.symbol === symbol);
    index = delistedOracle ? delistedOracle['marketIndex'] : -1;
  }

  return index;
}

export function getOracleBySymbol(group: GroupConfig, symbol: string) {
  return getOracleConfig(group, (o) => o.symbol === symbol);
}

export function getPerpMarketByBaseSymbol(group: GroupConfig, symbol: string) {
  return getPerpMarketConfig(group, (p) => p.baseSymbol === symbol);
}

export function getPerpMarketByIndex(
  group: GroupConfig,
  marketIndex: number,
): PerpMarketConfig | undefined {
  return getPerpMarketConfig(group, (p) => p.marketIndex === marketIndex);
}

export function getSpotMarketByBaseSymbol(group: GroupConfig, symbol: string) {
  return getSpotMarketConfig(group, (p) => p.baseSymbol === symbol);
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
  const spot = getSpotMarketConfig(group, (m) =>
    m.publicKey.equals(key as PublicKey),
  );
  if (spot) {
    return { kind: 'spot', ...spot } as MarketConfig;
  }
  const perp = getPerpMarketConfig(group, (m) =>
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
  return getTokenConfig(group, (t) => t.mintKey.equals(mint as PublicKey));
}

export function getTokenBySymbol(
  group: GroupConfig,
  symbol: string,
): TokenConfig {
  const tokenConfig = getTokenConfig(group, (t) => t.symbol === symbol);
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
