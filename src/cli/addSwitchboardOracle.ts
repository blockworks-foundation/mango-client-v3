import { Account, Connection, PublicKey } from '@solana/web3.js';
import { MangoClient } from '../client';
import { getOracleBySymbol, GroupConfig } from '../config';

// devnet
const SWITCHBOARD_ORACLES_DEVNET = {
  MNGO: '8k7F9Xb36oFJsjpCKpsXvg4cgBRoZtwNTc3EzG5Ttd2o',
};

// mainnet
const SWITCHBOARD_ORACLES_MAINNET = {
  RAY: 'AS2yMpqPY16tY5hQmpdkomaqSckMuDvR6K9P9tk9FA4d',
  MNGO: '49cnp1ejyvQi3CJw3kKXNCDGnNbWDuZd3UG3Y2zGvQkX',
};

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
  let oraclePk;
  if (groupConfig.cluster === 'mainnet') {
    oraclePk = new PublicKey(SWITCHBOARD_ORACLES_MAINNET[symbol]);
  } else {
    oraclePk = new PublicKey(SWITCHBOARD_ORACLES_DEVNET[symbol]);
  }
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
