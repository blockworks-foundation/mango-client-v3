import { Account, Connection, PublicKey } from '@solana/web3.js';
import { MerpsClient } from '../client';
import {
  getOracleBySymbol,
  getPerpMarketByBaseSymbol,
  GroupConfig,
  OracleConfig,
} from '../config';

export default async function addSpotMarket(
  connection: Connection,
  payer: Account,
  groupConfig: GroupConfig,
  symbol: string,
  spotMarket: string,
  maintLeverage: number,
  initLeverage: number,
): Promise<GroupConfig> {
  const client = new MerpsClient(connection, groupConfig.merps_program_id);

  let group = await client.getMerpsGroup(groupConfig.key);
  const oracleDesc = getOracleBySymbol(groupConfig, symbol) as OracleConfig;
  const marketIndex = group.getOracleIndex(oracleDesc.key);

  console.log('maint leverage', maintLeverage, initLeverage);

  await client.addSpotMarket(
    group,
    new PublicKey(spotMarket),
    group.tokens[marketIndex].mint,
    payer,
    marketIndex,
    maintLeverage,
    initLeverage,
  );

  group = await client.getMerpsGroup(groupConfig.key);

  const marketDesc = {
    base_symbol: symbol,
    key: group.spotMarkets[marketIndex].spotMarket,
    market_index: marketIndex,
  };

  const market = getPerpMarketByBaseSymbol(groupConfig, symbol);
  if (market) {
    Object.assign(market, marketDesc);
  } else {
    groupConfig.spot_markets.push(marketDesc);
  }

  return groupConfig;
}
