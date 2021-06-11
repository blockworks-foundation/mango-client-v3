import * as os from 'os';
import * as fs from 'fs';
import { MerpsClient } from './client';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import { QUOTE_INDEX } from '../src/MerpsGroup';
import { sleep } from './utils';

function assertEq(msg, a, b) {
  if (a !== b) {
    throw new Error(`${msg}: ${a} !== ${b}`);
  }
}

// export const BTCMint = new PublicKey(
//   '3ZTThPgKSNbMzT3yK9Y43fU2ZMuQ6jprwpgfpvDw7b8j',
// );
// export const BTCFaucet = new PublicKey(
//   'FnS8ceYHXUarddKcFCGrFMVFWqfRku2bEippH6FtkDX6',
// );
// export const FAUCET_PROGRAM_ID = new PublicKey(
//   '4bXpkKSV8swHSnwqtzuboGPaPDeEgAn4Vt8GfarV5rZt',
// );

async function test() {
  console.log('starting test');

  const merpsProgramId = new PublicKey(
    'H3Xu3m3qiYZmXcdUDTEhQNJSui7bcfziphw8LGvot9Hp',
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
  const payerQuoteTokenAcc = new PublicKey(
    'GZira1ybvTWJsZEvqgjSuohir2uAvd1gV9joVvS6K9xr',
  );

  // const userBtcPk = new PublicKey('userBtcPk');
  console.log('creating connection');

  const connection = new Connection(
    'https://api.devnet.solana.com',
    'processed' as Commitment,
  );
  console.log('connection created');

  const client = new MerpsClient(connection, merpsProgramId);

  const quoteMintKey = new PublicKey(
    'H6hy7Ykzc43EuGivv7VVuUKNpKgUoFAfUY3wdPr4UyRX',
  );
  console.log('creating merps group');

  const groupKey = await client.initMerpsGroup(
    payer,
    quoteMintKey,
    dexProgramId,
    5,
  );
  console.log('merps group created', groupKey);

  await sleep(3000);
  const merpsGroup = await client.getMerpsGroup(groupKey);
  await sleep(3000);
  const rootBanks = await merpsGroup.loadRootBanks(client.connection);
  const usdcRootBank = rootBanks[QUOTE_INDEX];

  console.log('Group Created:', merpsGroup.publicKey.toBase58());

  assertEq(
    'quoteMint',
    merpsGroup.tokens[QUOTE_INDEX].mint.toBase58(),
    quoteMintKey.toBase58(),
  );
  assertEq('admin', merpsGroup.admin.toBase58(), payer.publicKey.toBase58());
  assertEq(
    'dexProgramId',
    merpsGroup.dexProgramId.toBase58(),
    dexProgramId.toBase58(),
  );
  await sleep(3000);
  const merpsAccountPk = await client.initMerpsAccount(merpsGroup, payer);
  console.log('init merps acc', merpsAccountPk.toString());

  const merpsAccount = await client.getMerpsAccount(
    merpsAccountPk,
    dexProgramId,
  );

  if (!usdcRootBank) throw new Error('no root bank');
  console.log('get node banks');

  const nodeBanks = await usdcRootBank.loadNodeBanks(client.connection);
  const filteredNodeBanks = nodeBanks.filter((nodeBank) => !!nodeBank);

  if (!filteredNodeBanks[0]) throw new Error('node banks empty');

  await sleep(10000);
  console.log('depositing');

  try {
    await client.deposit(
      merpsGroup,
      merpsAccount,
      payer,
      merpsGroup.tokens[QUOTE_INDEX].rootBank,
      usdcRootBank.nodeBanks?.[0],
      filteredNodeBanks[0].vault,
      payerQuoteTokenAcc,
      10,
    );
  } catch (err) {
    console.log('Error on deposit', `${err}`);
    console.log('txid', err?.txid);
  }

  // const cacheRootBanksTxID = await client.cacheRootBanks(
  //   payer,
  //   merpsGroup.publicKey,
  //   merpsGroup.merpsCache,
  //   [],
  // );
  // console.log('Cache Updated:', cacheRootBanksTxID);
}

test();
