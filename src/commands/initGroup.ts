import { Account, Connection, PublicKey } from '@solana/web3.js';
import { MerpsClient } from '../client';

export default async function initGroup(
  connection: Connection,
  payer: Account,
  groupName: string,
  merpsProgramId: PublicKey,
  serumProgramId: PublicKey,
  quoteSymbol: string,
  quoteMint: PublicKey,
  validInterval = 5,
) {
  const client = new MerpsClient(connection, merpsProgramId);
  const groupKey = await client.initMerpsGroup(
    payer,
    quoteMint,
    serumProgramId,
    validInterval,
  );
  const group = await client.getMerpsGroup(groupKey);
  const banks = await group.loadRootBanks(connection);

  // format result
  const mintDesc = {
    symbol: quoteSymbol,
    key: quoteMint.toBase58(),
  };
  const bankDesc = {
    symbol: quoteSymbol,
    root_key: banks[0]?.publicKey.toBase58(),
    node_keys: banks[0]?.nodeBanks.map((k) => k.toBase58()),
  };
  const groupDesc = {
    name: groupName,
    key: groupKey.toBase58(),
    merps_program_id: merpsProgramId.toBase58(),
    serum_program_id: serumProgramId.toBase58(),
    mints: [mintDesc],
    banks: [bankDesc],
  };
  return groupDesc;
}
