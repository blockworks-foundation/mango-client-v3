/**
 * This script was used to reimburse accounts affected by Dec 4 MSOL oracle incident
 */

import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import os from 'os';
import {
  Config,
  findLargestTokenAccountForOwner,
  GroupConfig,
  IDS,
  MangoClient,
  QUOTE_INDEX,
  RootBank,
} from '../src';

const config = new Config(IDS);

const payer = new Account(
  JSON.parse(
    fs.readFileSync(
      process.env.KEYPAIR || os.homedir() + '/.config/solana/id.json',
      'utf-8',
    ),
  ),
);

const groupName = process.env.GROUP || 'mainnet.1';
const groupIds = config.getGroupWithName(groupName) as GroupConfig;
const cluster = groupIds.cluster;
const mangoProgramId = groupIds.mangoProgramId;
const mangoGroupKey = groupIds.publicKey;
const connection = new Connection(
  process.env.ENDPOINT_URL || config.cluster_urls[cluster],
  'processed' as Commitment,
);
const client = new MangoClient(connection, mangoProgramId);

const accountReimbursements = [
  {
    mangoAccountPubkey: '2djENyoL1HhRj3dELXv2N5z6buuyinrGfTd7Dn9asvST',
    amount: 76723.12,
  },
  {
    mangoAccountPubkey: '2nxUQGyysW7FB7apwjkFdnReZq2bA1JmgqT67fdaRUTE',
    amount: 2056.63,
  },
  {
    mangoAccountPubkey: '62tjaFUr1cjTyHbZWzo6UW2NYEmuXzxWdLZhJ7mMxUxw',
    amount: 10436.11,
  },
];

async function reimburse() {
  const mangoGroup = await client.getMangoGroup(mangoGroupKey);
  const rootBanks = await mangoGroup.loadRootBanks(connection);
  const quoteRootBank = rootBanks[QUOTE_INDEX] as RootBank;
  const nodeBank = quoteRootBank.nodeBankAccounts[0];

  const quoteTokenAccount = await findLargestTokenAccountForOwner(
    connection,
    payer.publicKey,
    mangoGroup.tokens[QUOTE_INDEX].mint,
  );

  for (const info of accountReimbursements) {
    const mangoAccount = await client.getMangoAccount(
      new PublicKey(info.mangoAccountPubkey),
      mangoGroup.dexProgramId,
    );

    const txid = await client.deposit(
      mangoGroup,
      mangoAccount,
      payer,
      quoteRootBank.publicKey,
      nodeBank.publicKey,
      nodeBank.vault,
      quoteTokenAccount.publicKey,
      info.amount,
    );
    console.log(
      `txid: ${txid.toString()}\nSuccessfully reimbursed ${
        info.amount
      } to ${mangoAccount.publicKey.toBase58()}.`,
    );
  }
}

reimburse();
