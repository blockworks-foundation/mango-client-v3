import { Account, Connection, PublicKey } from '@solana/web3.js';
import { MerpsClient } from '../client';
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
  const client = new MerpsClient(connection, groupConfig.merps_program_id);

  let group = await client.getMerpsGroup(groupConfig.key);
  const oracleDesc = getOracleBySymbol(groupConfig, symbol) as OracleConfig;
  const marketIndex = group.getOracleIndex(oracleDesc.key);

  await client.addSpotMarket(
    group,
    spotMarket,
    baseMint,
    payer,
    marketIndex,
    maintLeverage,
    initLeverage,
  );

  group = await client.getMerpsGroup(groupConfig.key);
  const banks = await group.loadRootBanks(connection);
  const tokenIndex = group.getTokenIndex(baseMint);
  const nodeBanks = await banks[tokenIndex]?.loadNodeBanks(connection);

  const tokenDesc = {
    symbol,
    mint_key: baseMint,
    decimals: group.tokens[tokenIndex].decimals,
    root_key: banks[tokenIndex]?.publicKey as PublicKey,
    node_keys: nodeBanks?.map((n) => n?.publicKey) as PublicKey[],
  };

  const token = getTokenBySymbol(groupConfig, symbol);
  if (token) {
    Object.assign(token, tokenDesc);
  } else {
    groupConfig.tokens.push(tokenDesc);
  }

  const marketDesc = {
    base_symbol: symbol,
    key: spotMarket,
    market_index: marketIndex,
    name: `${symbol}/${groupConfig.quote_symbol}`,
  };

  const market = getSpotMarketByBaseSymbol(groupConfig, symbol);
  if (market) {
    Object.assign(market, marketDesc);
  } else {
    groupConfig.spot_markets.push(marketDesc);
  }

  return groupConfig;
}
