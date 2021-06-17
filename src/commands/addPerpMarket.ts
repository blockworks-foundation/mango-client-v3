import { Account, Connection } from '@solana/web3.js';
import { MerpsClient } from '../client';
import {
  getOracleBySymbol,
  getPerpMarketByBaseSymbol,
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
  baseLotSize: number,
  quoteLotSize: number,
  maxNumEvents: number,
): Promise<GroupConfig> {
  console.log({
    connection,
    payer,
    groupConfig,
    symbol,
  });

  const client = new MerpsClient(connection, groupConfig.merps_program_id);

  let group = await client.getMerpsGroup(groupConfig.key);
  const oracleDesc = getOracleBySymbol(groupConfig, symbol) as OracleConfig;
  const marketIndex = group.getOracleIndex(oracleDesc.key);

  await client.addPerpMarket(
    groupConfig.key,
    payer,
    marketIndex,
    maintLeverage,
    initLeverage,
    baseLotSize,
    quoteLotSize,
    maxNumEvents,
  );

  group = await client.getMerpsGroup(groupConfig.key);

  const marketDesc = {
    base_symbol: symbol,
    key: group.perpMarkets[marketIndex].perpMarket,
    market_index: marketIndex,
    name: `${symbol}-PERP`,
  };

  const market = getPerpMarketByBaseSymbol(groupConfig, symbol);
  if (market) {
    Object.assign(market, marketDesc);
  } else {
    groupConfig.perp_markets.push(marketDesc);
  }

  return groupConfig;
}
