import { Market } from '@project-serum/serum';
import { Account, Connection, PublicKey } from '@solana/web3.js';
import { MangoClient } from '../client';
import {
  getOracleBySymbol,
  getSpotMarketByBaseSymbol,
  getTokenBySymbol,
  GroupConfig,
  OracleConfig,
} from '../config';

export default async function addSpotMarket(
  connection: Connection,
  payer: Account,
  groupConfig: GroupConfig,
  symbol: string,
  spotMarket: PublicKey,
  baseMint: PublicKey,
  maintLeverage: number,
  initLeverage: number,
  liquidationFee: number,
  optimalUtil: number,
  optimalRate: number,
  maxRate: number,
): Promise<GroupConfig> {
  const client = new MangoClient(connection, groupConfig.mangoProgramId);

  let group = await client.getMangoGroup(groupConfig.publicKey);
  const oracleDesc = getOracleBySymbol(groupConfig, symbol) as OracleConfig;

  await client.addSpotMarket(
    group,
    oracleDesc.publicKey,
    spotMarket,
    baseMint,
    payer,
    maintLeverage,
    initLeverage,
    liquidationFee,
    optimalUtil,
    optimalRate,
    maxRate,
  );

  group = await client.getMangoGroup(groupConfig.publicKey);
  const market = await Market.load(
    connection,
    spotMarket,
    undefined,
    groupConfig.serumProgramId,
  );
  const banks = await group.loadRootBanks(connection);
  const tokenIndex = group.getTokenIndex(baseMint);
  const nodeBanks = await banks[tokenIndex]?.loadNodeBanks(connection);

  const tokenDesc = {
    symbol,
    mintKey: baseMint,
    decimals: group.tokens[tokenIndex].decimals,
    rootKey: banks[tokenIndex]?.publicKey as PublicKey,
    nodeKeys: nodeBanks?.map((n) => n?.publicKey) as PublicKey[],
  };

  try {
    const token = getTokenBySymbol(groupConfig, symbol);
    Object.assign(token, tokenDesc);
  } catch (_) {
    groupConfig.tokens.push(tokenDesc);
  }

  const marketDesc = {
    name: `${symbol}/${groupConfig.quoteSymbol}`,
    publicKey: spotMarket,
    baseSymbol: symbol,
    baseDecimals: market['_baseSplTokenDecimals'],
    quoteDecimals: market['_quoteSplTokenDecimals'],
    marketIndex: tokenIndex,
    bidsKey: market.bidsAddress,
    asksKey: market.asksAddress,
    eventsKey: market['_decoded'].eventQueue,
  };

  const marketConfig = getSpotMarketByBaseSymbol(groupConfig, symbol);
  if (marketConfig) {
    Object.assign(marketConfig, marketDesc);
  } else {
    groupConfig.spotMarkets.push(marketDesc);
  }

  return groupConfig;
}
