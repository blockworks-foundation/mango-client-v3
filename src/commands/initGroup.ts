import { Account, Connection, PublicKey } from '@solana/web3.js';
import { MerpsClient } from '../client';
import { Cluster, GroupConfig } from '../config';

export default async function initGroup(
  connection: Connection,
  payer: Account,
  cluster: Cluster,
  groupName: string,
  merpsProgramId: PublicKey,
  serumProgramId: PublicKey,
  quoteSymbol: string,
  quoteMint: PublicKey,
  validInterval = 5,
): Promise<GroupConfig> {
  console.log({
    connection,
    payer,
    groupName,
    merpsProgramId,
    serumProgramId,
    quoteSymbol,
    quoteMint,
    validInterval,
  });

  const client = new MerpsClient(connection, merpsProgramId);
  const groupKey = await client.initMerpsGroup(
    quoteMint,
    serumProgramId,
    validInterval,
    payer,
  );
  const group = await client.getMerpsGroup(groupKey);
  const banks = await group.loadRootBanks(connection);
  const tokenIndex = group.getTokenIndex(quoteMint);
  const nodeBanks = await banks[tokenIndex]?.loadNodeBanks(connection);

  const tokenDesc = {
    symbol: quoteSymbol,
    mint_key: quoteMint,
    decimals: group.tokens[tokenIndex].decimals,
    root_key: banks[tokenIndex]?.publicKey as PublicKey,
    node_keys: nodeBanks?.map((n) => n?.publicKey) as PublicKey[],
  };
  const groupDesc = {
    cluster,
    name: groupName,
    key: groupKey,
    merps_program_id: merpsProgramId,
    serum_program_id: serumProgramId,
    tokens: [tokenDesc],
    oracles: [],
  };
  return groupDesc;
}
