/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as os from 'os';
import * as fs from 'fs';
import { MangoClient } from './client';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import MangoGroup, { QUOTE_INDEX } from '../src/MangoGroup';
import { sleep } from './utils';
import { I80F48 } from './fixednum';
import { Market } from '@project-serum/serum';
import * as Test from '../test/utils';
import { u64 } from '@solana/spl-token';
import { findLargestTokenAccountForOwner } from './token';

function assertEq(msg, a, b) {
  if (a !== b) {
    throw new Error(`${msg}: ${a} !== ${b}`);
  }
}

const mangoProgramId = new PublicKey(
  '32WeJ46tuY6QEkgydqzHYU5j85UT9m1cPJwFxPjuSVCt',
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

const MAX_RATE = 1.5;
const OPTIMAL_UTIL = 0.7;
const OPTIMAL_RATE = 0.06;

const SLEEP_TIME = 2000;

const payer = new Account(
  JSON.parse(
    fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
  ),
);
const client = new MangoClient(connection, mangoProgramId);

async function init_mango_group_and_spot_market(): Promise<MangoGroup> {
  const groupKey = await client.initMangoGroup(
    quoteMintKey,
    serumDexPk,
    500,
    OPTIMAL_UTIL,
    OPTIMAL_RATE,
    MAX_RATE,
    payer,
  );
  console.log('= mango group created =');
  let mangoGroup = await client.getMangoGroup(groupKey);
  assertEq(
    'quoteMint',
    mangoGroup.tokens[QUOTE_INDEX].mint.toBase58(),
    quoteMintKey.toBase58(),
  );
  assertEq('admin', mangoGroup.admin.toBase58(), payer.publicKey.toBase58());
  assertEq(
    'serumDexPk',
    mangoGroup.dexProgramId.toBase58(),
    serumDexPk.toBase58(),
  );
  await sleep(SLEEP_TIME);

  let btcOraclePk;
  try {
    console.log('= adding oracle =');
    btcOraclePk = await Test.createOracle(connection, mangoProgramId, payer);
    await client.addOracle(mangoGroup, btcOraclePk, payer);
    await client.setOracle(
      mangoGroup,
      btcOraclePk,
      payer,
      I80F48.fromNumber(40000),
    );
  } catch (err) {
    console.log('Error on adding oracle', `${err}`);
  }
  await sleep(SLEEP_TIME);
  const initLeverage = 5;
  const maintLeverage = initLeverage * 2;
  const marketIndex = 0;
  console.log('= adding spot market =');
  await client.addSpotMarket(
    mangoGroup,
    btcUsdSpotMarket,
    btcMint,
    payer,
    marketIndex,
    maintLeverage,
    initLeverage,
    OPTIMAL_UTIL,
    OPTIMAL_RATE,
    MAX_RATE,
  );
  await sleep(SLEEP_TIME);
  mangoGroup = await client.getMangoGroup(groupKey);
  return mangoGroup;
}

async function test_place_spot_order() {
  console.log('= starting =');

  let mangoGroup = await init_mango_group_and_spot_market();

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

  const mangoAccountPk = await client.initMangoAccount(mangoGroup, payer);
  await sleep(SLEEP_TIME); // devnet rate limits
  let mangoAccount = await client.getMangoAccount(mangoAccountPk, serumDexPk);

  await sleep(SLEEP_TIME); // devnet rate limits
  let rootBanks = await mangoGroup.loadRootBanks(client.connection);
  const usdcRootBank = rootBanks[QUOTE_INDEX];
  if (!usdcRootBank) throw new Error('no root bank');
  const quoteNodeBank = usdcRootBank.nodeBankAccounts[0];

  const marketIndex = 0;

  // run keeper fns
  await client.cacheRootBanks(
    mangoGroup.publicKey,
    mangoGroup.mangoCache,
    [
      mangoGroup.tokens[marketIndex].rootBank,
      mangoGroup.tokens[QUOTE_INDEX].rootBank,
    ],
    payer,
  );

  await sleep(SLEEP_TIME); // devnet rate limits
  try {
    console.log('= depositing =');
    await client.deposit(
      mangoGroup,
      mangoAccount,
      payer,
      mangoGroup.tokens[QUOTE_INDEX].rootBank,
      usdcRootBank.nodeBanks?.[0],
      quoteNodeBank.vault,
      userQuoteTokenAcc.publicKey,
      1000, // quantity
    );
  } catch (err) {
    console.log('Error on deposit', `${err}`);
  }

  await sleep(SLEEP_TIME); // avoid devnet rate limit
  console.log('= adding to basket =');

  // await client.addToBasket(mangoGroup, mangoAccount, payer, marketIndex);

  mangoGroup = await client.getMangoGroup(mangoGroup.publicKey);
  await sleep(SLEEP_TIME); // avoid devnet rate limit

  // run keeper fns
  const cacheRootBanksTxID = await client.cacheRootBanks(
    mangoGroup.publicKey,
    mangoGroup.mangoCache,
    [
      mangoGroup.tokens[marketIndex].rootBank,
      mangoGroup.tokens[QUOTE_INDEX].rootBank,
    ],
    payer,
  );
  await client.cachePrices(
    mangoGroup.publicKey,
    mangoGroup.mangoCache,
    [mangoGroup.oracles[marketIndex]],
    payer,
  );
  console.log('= cache updated =', cacheRootBanksTxID);

  rootBanks = await mangoGroup.loadRootBanks(client.connection);
  await sleep(SLEEP_TIME); // avoid devnet rate limit

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
  sleep(SLEEP_TIME);

  await client.updateRootBank(
    mangoGroup.publicKey,
    btcRootBank.publicKey,
    filteredBtcNodeBanks.map((bank) => bank!.publicKey),
    payer,
  );
  await client.updateRootBank(
    mangoGroup.publicKey,
    usdcRootBank.publicKey,
    [quoteNodeBank.publicKey],
    payer,
  );

  await sleep(SLEEP_TIME); // devnet rate limits
  mangoAccount = await client.getMangoAccount(mangoAccountPk, serumDexPk);
  const btcSpotMarket = await Market.load(
    connection,
    btcUsdSpotMarket,
    {},
    serumDexPk,
  );

  try {
    console.log('= placing spot order =');
    await client.placeSpotOrder(
      mangoGroup,
      mangoAccount,
      mangoGroup.mangoCache,
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

  await sleep(SLEEP_TIME);
  mangoAccount = await client.getMangoAccount(mangoAccountPk, serumDexPk);

  console.log('= borrow and withdraw =');
  await client.withdraw(
    mangoGroup,
    mangoAccount,
    payer,
    mangoGroup.tokens[marketIndex].rootBank,
    btcRootBank.nodeBanks?.[0],
    filteredBtcNodeBanks[0].vault,
    userBtcTokenAcc.publicKey,
    0.5, // withdraw amount
    true, // allow borrow
  );

  // console.log('= cancel order =');
  // await client.cancelSpotOrder(
  //   mangoGroup,
  //   mangoAccount,
  //   payer,
  //   btcSpotMarket,
  //   openOrdersAccounts[0],
  // );
}

test_place_spot_order();
