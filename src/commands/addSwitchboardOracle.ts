import { Account, Connection, PublicKey } from '@solana/web3.js';
import { MangoClient } from '../client';
import { getOracleBySymbol, GroupConfig } from '../config';

const SWITCHBOARD_ORACLES = {
  MNGO: '8k7F9Xb36oFJsjpCKpsXvg4cgBRoZtwNTc3EzG5Ttd2o',
}

export default async function addSwitchboardOracle(
  connection: Connection,
  payer: Account,
  groupConfig: GroupConfig,
  symbol: string,
): Promise<GroupConfig> {
  console.log({
    connection,
    payer,
    groupConfig,
    symbol,
  });

  const client = new MangoClient(connection, groupConfig.mangoProgramId);
  const group = await client.getMangoGroup(groupConfig.publicKey);
  const oraclePk = new PublicKey(SWITCHBOARD_ORACLES[symbol]);
  await client.addOracle(group, oraclePk, payer);

  const oracle = {
    symbol: symbol,
    publicKey: oraclePk,
  };

  const _oracle = getOracleBySymbol(groupConfig, symbol);
  if (_oracle) {
    Object.assign(_oracle, oracle);
  } else {
    groupConfig.oracles.push(oracle);
  }

  return groupConfig;
}
