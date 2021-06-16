import { Account, Connection } from '@solana/web3.js';
import { MerpsClient } from '../client';
import { getOracleBySymbol, GroupConfig } from '../config';

export default async function addStubOracle(
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

  const client = new MerpsClient(connection, groupConfig.merps_program_id);
  await client.addStubOracle(groupConfig.key, payer);
  const group = await client.getMerpsGroup(groupConfig.key);

  const oracle = {
    symbol: symbol,
    key: group.oracles[group.numOracles - 1],
  };

  const _oracle = getOracleBySymbol(groupConfig, symbol);
  if (_oracle) {
    Object.assign(_oracle, oracle);
  } else {
    groupConfig.oracles.push(oracle);
  }

  return groupConfig;
}
