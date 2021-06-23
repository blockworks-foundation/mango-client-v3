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
): Promise<GroupConfig> {
  const client = new MangoClient(connection, groupConfig.mangoProgramId);

  let group = await client.getMangoGroup(groupConfig.publicKey);
  const oracleDesc = getOracleBySymbol(groupConfig, symbol) as OracleConfig;
  const marketIndex = group.getOracleIndex(oracleDesc.publicKey);

  await client.addSpotMarket(
    group,
    spotMarket,
    baseMint,
    payer,
    marketIndex,
    maintLeverage,
    initLeverage,
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

  const token = getTokenBySymbol(groupConfig, symbol);
  if (token) {
    Object.assign(token, tokenDesc);
  } else {
    groupConfig.tokens.push(tokenDesc);
  }

  const marketDesc = {
    name: `${symbol}/${groupConfig.quoteSymbol}`,
    publicKey: spotMarket,
    baseSymbol: symbol,
    baseDecimals: market['_baseSplTokenDecimals'],
    quoteDecimals: market['_quoteSplTokenDecimals'],
    marketIndex,
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
