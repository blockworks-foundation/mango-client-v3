import * as os from 'os';
import * as fs from 'fs';
import { MerpsClient } from './client';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';

function assertEq(msg, a, b) {
  if (a !== b) {
    throw new Error(`${msg}: ${a} !== ${b}`);
  }
}

async function test() {
  const merpsProgramId = new PublicKey(
    'EBXaJhhjhRKYDRNwHUgqJhMDWGNqKwpwD3sYkXRN9Yuz',
  );
  const dexProgramId = new PublicKey(
    'DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY',
  );
  const payer = new Account(
    JSON.parse(
      fs.readFileSync(
        os.homedir() + '/my-solana-wallet/my-keypair.json',
        'utf-8',
      ),
    ),
  );
  const connection = new Connection(
    'https://devnet.solana.com',
    'processed' as Commitment,
  );
  const client = new MerpsClient(connection, merpsProgramId);

  const quoteMintKey = new PublicKey(
    'H6hy7Ykzc43EuGivv7VVuUKNpKgUoFAfUY3wdPr4UyRX',
  );
  const groupKey = await client.initMerpsGroup(
    payer,
    quoteMintKey,
    dexProgramId,
    5,
  );

  const merpsGroup = await client.getMerpsGroup(groupKey);
  console.log('Group Created:', merpsGroup.publicKey.toBase58());
  assertEq(
    'quoteMint',
    merpsGroup.tokens[0].mint.toBase58(),
    quoteMintKey.toBase58(),
  );
  assertEq('admin', merpsGroup.admin.toBase58(), payer.publicKey.toBase58());
  assertEq(
    'dexProgramId',
    merpsGroup.dexProgramId.toBase58(),
    dexProgramId.toBase58(),
  );
  const cacheRootBanksTxID = await client.cacheRootBanks(
    payer,
    merpsGroup.publicKey,
    merpsGroup.merpsCache,
    [],
  );
  console.log('Cache Updated:', cacheRootBanksTxID);
}

test();
