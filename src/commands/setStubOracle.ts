import { Account, Connection } from '@solana/web3.js';
import { MerpsClient } from '../client';
import { getOracleBySymbol, GroupConfig, OracleConfig } from '../config';

export default async function setStubOracle(
  connection: Connection,
  payer: Account,
  groupConfig: GroupConfig,
  symbol: string,
  value: number,
) {
  const client = new MerpsClient(connection, groupConfig.merps_program_id);
  const oracle = getOracleBySymbol(groupConfig, symbol) as OracleConfig;
  await client.setStubOracle(groupConfig.key, oracle.key, payer, value);
}
