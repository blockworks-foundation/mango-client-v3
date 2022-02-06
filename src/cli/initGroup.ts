import { Account, Connection, PublicKey } from '@solana/web3.js';
import { MangoClient } from '../client';
import { Cluster, GroupConfig, msrmMints } from '../config';

export default async function initGroup(
  connection: Connection,
  payer: Account,
  cluster: Cluster,
  groupName: string,
  mangoProgramId: PublicKey,
  serumProgramId: PublicKey,
  quoteSymbol: string,
  quoteMint: PublicKey,
  feesVault: PublicKey,
  validInterval: number,
  quoteOptimalUtil: number,
  quoteOptimalRate: number,
  quoteMaxRate: number,
): Promise<GroupConfig> {
  console.log({
    connection,
    payer,
    groupName,
    mangoProgramId,
    serumProgramId,
    quoteSymbol,
    quoteMint,
    validInterval,
  });

  const client = new MangoClient(connection, mangoProgramId);

  const groupKey = await client.initMangoGroup(
    quoteMint,
    msrmMints[cluster],
    serumProgramId,
    feesVault,
    validInterval,
    quoteOptimalUtil,
    quoteOptimalRate,
    quoteMaxRate,
    payer,
  );
  const group = await client.getMangoGroup(groupKey);
  const banks = await group.loadRootBanks(connection);
  const tokenIndex = group.getTokenIndex(quoteMint);
  const nodeBanks = await banks[tokenIndex]?.loadNodeBanks(connection);

  console.log(banks);
  console.log(nodeBanks);

  const tokenDesc = {
    symbol: quoteSymbol,
    mintKey: quoteMint,
    decimals: group.tokens[tokenIndex].decimals,
    rootKey: banks[tokenIndex]?.publicKey as PublicKey,
    nodeKeys: nodeBanks?.map((n) => n?.publicKey) as PublicKey[],
  };
  const groupDesc = {
    cluster,
    name: groupName,
    publicKey: groupKey,
    quoteSymbol: quoteSymbol,
    mangoProgramId: mangoProgramId,
    serumProgramId: serumProgramId,
    tokens: [tokenDesc],
    oracles: [],
    perpMarkets: [],
    spotMarkets: [],
  };
  return groupDesc;
}
