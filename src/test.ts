import * as os from 'os';
import * as fs from 'fs';
import { MerpsClient } from './client';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import { QUOTE_INDEX } from '../src/MerpsGroup';
import { sleep } from './utils';
import { I80F48 } from './fixednum';

function assertEq(msg, a, b) {
  if (a !== b) {
    throw new Error(`${msg}: ${a} !== ${b}`);
  }
}

const merpsProgramId = new PublicKey(
  'Hc12EyQQ3XVNEE5URg7XjjtZA8sbUPnMeT1CXGbwN6ei',
);
const dexProgramId = new PublicKey(
  'DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY',
);
const payerQuoteTokenAcc = new PublicKey(
  '7f2xJqihAgdWVxqR4jLa5jxc7a4QxverYLntkc6FCYq',
);
const quoteMintKey = new PublicKey(
  'EMjjdsqERN4wJUR9jMBax2pzqQPeGLNn5NeucbHpDUZK',
);
const btcMint = new PublicKey('bypQzRBaSDWiKhoAw3hNkf35eF3z3AZCU8Sxks6mTPP');
const btcOraclePk = new PublicKey(
  'FuEnReoxhqW8Li6EMLoaaUWbWAEjTfSRuBARo5GrGCqN',
);
const btcUsdSpotMarket = new PublicKey(
  'E1mfsnnCcL24JcDQxr7F2BpWjkyy5x2WHys8EL2pnCj9',
);
const connection = new Connection(
  'https://api.devnet.solana.com',
  'processed' as Commitment,
);
const payer = new Account(
  JSON.parse(
    fs.readFileSync(
      os.homedir() + '/my-solana-wallet/my-keypair.json',
      'utf-8',
    ),
  ),
);

async function test() {
  const client = new MerpsClient(connection, merpsProgramId);
  const groupKey = await client.initMerpsGroup(
    payer,
    quoteMintKey,
    dexProgramId,
    5,
  );
  const merpsGroup = await client.getMerpsGroup(groupKey);
  await sleep(3000);
  const rootBanks = await merpsGroup.loadRootBanks(client.connection);
  const usdcRootBank = rootBanks[QUOTE_INDEX];

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

  const merpsAccountPk = await client.initMerpsAccount(merpsGroup, payer);

  await sleep(5000); // devnet rate limits
  const merpsAccount = await client.getMerpsAccount(
    merpsAccountPk,
    dexProgramId,
  );

  if (!usdcRootBank) throw new Error('no root bank');

  const nodeBanks = await usdcRootBank.loadNodeBanks(client.connection);
  const filteredNodeBanks = nodeBanks.filter((nodeBank) => !!nodeBank);

  if (!filteredNodeBanks[0]) throw new Error('node banks empty');

  await sleep(10000); // devnet rate limits

  try {
    console.log('depositing');
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
  }

  try {
    await client.addOracle(merpsGroup, btcOraclePk, payer);
  } catch (err) {
    console.log('Error on adding oracle', `${err}`);
  }
  const maxLeverage = 5;
  const maintAssetWeight = (2 * maxLeverage) / (2 * maxLeverage + 1);
  const initAssetWeight = maxLeverage / (maxLeverage + 1);

  await client.addSpotMarket(
    merpsGroup,
    btcUsdSpotMarket,
    btcMint,
    payer,
    0, // marketIndex
    I80F48.fromString(maintAssetWeight.toString()),
    I80F48.fromString(initAssetWeight.toString()),
  );
  // await client.addToBasket(merpsGroup, merpsAccount, payer);
  // const cacheRootBanksTxID = await client.cacheRootBanks(
  //   payer,
  //   merpsGroup.publicKey,
  //   merpsGroup.merpsCache,
  //   [],
  // );
  // console.log('Cache Updated:', cacheRootBanksTxID);
}

test();
