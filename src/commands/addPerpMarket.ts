import { Account, Connection } from '@solana/web3.js';
import { MangoClient } from '../client';
import {
  getOracleBySymbol,
  getPerpMarketByBaseSymbol,
  getTokenBySymbol,
  GroupConfig,
  OracleConfig,
} from '../config';

export default async function addPerpMarket(
  connection: Connection,
  payer: Account,
  groupConfig: GroupConfig,
  symbol: string,
  maintLeverage: number,
  initLeverage: number,
  makerFee: number,
  takerFee: number,
  baseLotSize: number,
  quoteLotSize: number,
  maxNumEvents: number,
  maxDepthBps: number,
  scaler: number,
): Promise<GroupConfig> {
  console.log({
    connection,
    payer,
    groupConfig,
    symbol,
  });

  const client = new MangoClient(connection, groupConfig.mangoProgramId);

  let group = await client.getMangoGroup(groupConfig.publicKey);
  const oracleDesc = getOracleBySymbol(groupConfig, symbol) as OracleConfig;
  const marketIndex = group.getOracleIndex(oracleDesc.publicKey);

  await client.addPerpMarket(
    groupConfig.publicKey,
    payer,
    marketIndex,
    maintLeverage,
    initLeverage,
    makerFee,
    takerFee,
    baseLotSize,
    quoteLotSize,
    maxNumEvents,
    maxDepthBps,
    scaler,
  );

  group = await client.getMangoGroup(groupConfig.publicKey);
  const marketPk = group.perpMarkets[marketIndex].perpMarket;
  const baseDecimals = getTokenBySymbol(groupConfig, symbol)
    ?.decimals as number;
  const quoteDecimals = getTokenBySymbol(groupConfig, groupConfig.quoteSymbol)
    ?.decimals as number;
  const market = await client.getPerpMarket(
    marketPk,
    baseDecimals,
    quoteDecimals,
  );

  const marketDesc = {
    name: `${symbol}-PERP`,
    publicKey: marketPk,
    baseSymbol: symbol,
    baseDecimals,
    quoteDecimals,
    marketIndex,
    bidsKey: market.bids,
    asksKey: market.asks,
    eventsKey: market.eventQueue,
  };

  const marketConfig = getPerpMarketByBaseSymbol(groupConfig, symbol);
  if (marketConfig) {
    Object.assign(marketConfig, marketDesc);
  } else {
    groupConfig.perpMarkets.push(marketDesc);
  }

  return groupConfig;
}
