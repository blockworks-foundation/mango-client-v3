/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as os from 'os';
import * as fs from 'fs';
import { MerpsClient } from './client';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import { QUOTE_INDEX } from '../src/MerpsGroup';
import { findLargestTokenAccountForOwner, sleep } from './utils';
import { I80F48 } from './fixednum';
import { Market } from '@project-serum/serum';
import * as Test from '../test/utils';
import { u64 } from '@solana/spl-token';
import { MerpsAccountLayout } from './layout';

function assertEq(msg, a, b) {
  if (a !== b) {
    throw new Error(`${msg}: ${a} !== ${b}`);
  }
}

const merpsProgramId = new PublicKey(
  'viQTKtBmaGvx3nugHcvijedy9ApbDowqiGYq35qAJqq',
);
const serumDexPk = new PublicKey(
  'DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY',
);
const quoteMintKey = new PublicKey(
  'EMjjdsqERN4wJUR9jMBax2pzqQPeGLNn5NeucbHpDUZK',
);
const btcMint = new PublicKey('bypQzRBaSDWiKhoAw3hNkf35eF3z3AZCU8Sxks6mTPP');
const btcFaucetPk = new PublicKey(
  '454w2aqqmu3tzY3dgCh8gCk6jwQcxdo6ojvqj2JcLJqh',
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
    fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
  ),
);

async function test() {
  console.log('= starting =');

  console.log(MerpsAccountLayout.span);

  const client = new MerpsClient(connection, merpsProgramId);
  const userQuoteTokenAcc = await findLargestTokenAccountForOwner(
    connection,
    payer.publicKey,
    quoteMintKey,
  );
  const userBtcTokenAcc = await findLargestTokenAccountForOwner(
    connection,
    payer.publicKey,
    btcMint,
  );
  const groupKey = await client.initMerpsGroup(
    quoteMintKey,
    serumDexPk,
    500,
    payer,
  );
  console.log('= merps group created =');
  let merpsGroup = await client.getMerpsGroup(groupKey);
  assertEq(
    'quoteMint',
    merpsGroup.tokens[QUOTE_INDEX].mint.toBase58(),
    quoteMintKey.toBase58(),
  );
  assertEq('admin', merpsGroup.admin.toBase58(), payer.publicKey.toBase58());
  assertEq(
    'serumDexPk',
    merpsGroup.dexProgramId.toBase58(),
    serumDexPk.toBase58(),
  );

  const merpsAccountPk = await client.initMerpsAccount(merpsGroup, payer);
  await sleep(5000); // devnet rate limits
  let merpsAccount = await client.getMerpsAccount(merpsAccountPk, serumDexPk);

  await sleep(5000); // devnet rate limits
  let rootBanks = await merpsGroup.loadRootBanks(client.connection);
  const usdcRootBank = rootBanks[QUOTE_INDEX];
  if (!usdcRootBank) throw new Error('no root bank');
  const quoteNodeBanks = await usdcRootBank.loadNodeBanks(client.connection);
  const filteredQuoteNodeBanks = quoteNodeBanks.filter((bank) => !!bank);
  if (!filteredQuoteNodeBanks[0]) throw new Error('node banks empty');

  await sleep(5000); // devnet rate limits
  try {
    console.log('= depositing =');
    await client.deposit(
      merpsGroup,
      merpsAccount,
      payer,
      merpsGroup.tokens[QUOTE_INDEX].rootBank,
      usdcRootBank.nodeBanks?.[0],
      filteredQuoteNodeBanks[0].vault,
      userQuoteTokenAcc.publicKey,
      1000, // quantity
    );
  } catch (err) {
    console.log('Error on deposit', `${err}`);
  }

  let btcOraclePk;
  try {
    console.log('= adding oracle =');
    btcOraclePk = await Test.createOracle(connection, merpsProgramId, payer);
    await client.addOracle(merpsGroup, btcOraclePk, payer);
    await client.setOracle(
      merpsGroup,
      btcOraclePk,
      payer,
      I80F48.fromNumber(40000),
    );
  } catch (err) {
    console.log('Error on adding oracle', `${err}`);
  }

  const initLeverage = 5;
  const maintLeverage = initLeverage * 2;
  const marketIndex = 0;
  console.log('= adding spot market =');
  await client.addSpotMarket(
    merpsGroup,
    btcUsdSpotMarket,
    btcMint,
    payer,
    marketIndex,
    I80F48.fromNumber(maintLeverage),
    I80F48.fromNumber(initLeverage),
  );

  await sleep(10000); // avoid devnet rate limit
  console.log('= adding to basket =');

  await client.addToBasket(merpsGroup, merpsAccount, payer, marketIndex);

  merpsGroup = await client.getMerpsGroup(groupKey);
  await sleep(5000); // avoid devnet rate limit

  // run keeper fns
  const cacheRootBanksTxID = await client.cacheRootBanks(
    merpsGroup.publicKey,
    merpsGroup.merpsCache,
    [
      merpsGroup.tokens[marketIndex].rootBank,
      merpsGroup.tokens[QUOTE_INDEX].rootBank,
    ],
    payer,
  );
  await client.cachePrices(
    merpsGroup.publicKey,
    merpsGroup.merpsCache,
    [btcOraclePk],
    payer,
  );
  console.log('= cache updated =', cacheRootBanksTxID);

  rootBanks = await merpsGroup.loadRootBanks(client.connection);
  await sleep(5000); // avoid devnet rate limit

  const btcRootBank = rootBanks[marketIndex];
  if (!btcRootBank) throw new Error('no root bank');
  const btcNodeBanks = await btcRootBank.loadNodeBanks(client.connection);
  const filteredBtcNodeBanks = btcNodeBanks.filter((nodeBank) => !!nodeBank);
  if (!filteredBtcNodeBanks[0]) throw new Error('node banks empty');

  console.log('= airdropping in btc vault =');
  const multiplier = Math.pow(10, 6);
  const btcAmount = 5 * multiplier;
  await Test.airdropTokens(
    connection,
    payer,
    btcFaucetPk,
    filteredBtcNodeBanks[0].vault,
    btcMint,
    new u64(btcAmount),
  );
  sleep(5000);

  await client.updateRootBank(
    merpsGroup.publicKey,
    btcRootBank.publicKey,
    filteredBtcNodeBanks.map((bank) => bank!.publicKey),
    payer,
  );
  await client.updateRootBank(
    merpsGroup.publicKey,
    usdcRootBank.publicKey,
    filteredQuoteNodeBanks.map((bank) => bank!.publicKey),
    payer,
  );

  await sleep(5000); // devnet rate limits
  merpsAccount = await client.getMerpsAccount(merpsAccountPk, serumDexPk);
  const btcSpotMarket = await Market.load(
    connection,
    btcUsdSpotMarket,
    {},
    serumDexPk,
  );

  try {
    console.log('= placing spot order =');
    await client.placeSpotOrder(
      merpsGroup,
      merpsAccount,
      merpsGroup.merpsCache,
      btcSpotMarket,
      payer,
      'buy',
      30000, // price
      0.0001, // size
      'limit',
    );
  } catch (e) {
    console.log('Error placing order', `${e}`);
  }

  await sleep(5000);
  merpsAccount = await client.getMerpsAccount(merpsAccountPk, serumDexPk);

  console.log('= borrow and withdraw =');
  await client.withdraw(
    merpsGroup,
    merpsAccount,
    payer,
    merpsGroup.tokens[marketIndex].rootBank,
    btcRootBank.nodeBanks?.[0],
    filteredBtcNodeBanks[0].vault,
    userBtcTokenAcc.publicKey,
    0.5, // withdraw amount
    true, // allow borrow
  );

  // console.log('= cancel order =');
  // await client.cancelSpotOrder(
  //   merpsGroup,
  //   merpsAccount,
  //   payer,
  //   btcSpotMarket,
  //   openOrdersAccounts[0],
  // );
}

test();
