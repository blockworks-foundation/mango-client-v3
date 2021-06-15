import * as os from 'os';
import * as fs from 'fs';
import { MerpsClient } from './client';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import { QUOTE_INDEX } from '../src/MerpsGroup';
import { sleep } from './utils';
import { I80F48 } from './fixednum';
import { Market } from '@project-serum/serum';
import * as Test from '../test/utils';

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
const quoteMintKey = new PublicKey(
  'EMjjdsqERN4wJUR9jMBax2pzqQPeGLNn5NeucbHpDUZK',
);
const btcMint = new PublicKey('bypQzRBaSDWiKhoAw3hNkf35eF3z3AZCU8Sxks6mTPP');

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
const payerQuoteTokenAcc = new PublicKey(
  '7f2xJqihAgdWVxqR4jLa5jxc7a4QxverYLntkc6FCYq',
);
// const payerBtcTokenAcc = new PublicKey(
//   'FHfBgNkxVyDYUkJHYExRxCVnQtk7gVRU9ycQSyvQinJm',
// );

async function test() {
  const client = new MerpsClient(connection, merpsProgramId);
  const groupKey = await client.initMerpsGroup(
    payer,
    quoteMintKey,
    dexProgramId,
    500,
  );
  let merpsGroup = await client.getMerpsGroup(groupKey);
  await sleep(3000); // devnet rate limits
  let rootBanks = await merpsGroup.loadRootBanks(client.connection);
  const usdcRootBank = rootBanks[QUOTE_INDEX];
  if (!usdcRootBank) throw new Error('no root bank');

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
  let merpsAccount = await client.getMerpsAccount(merpsAccountPk, dexProgramId);

  const quoteNodeBanks = await usdcRootBank.loadNodeBanks(client.connection);
  const filteredQuoteNodeBanks = quoteNodeBanks.filter(
    (nodeBank) => !!nodeBank,
  );
  if (!filteredQuoteNodeBanks[0]) throw new Error('node banks empty');

  await sleep(10000); // devnet rate limits

  try {
    console.log('depositing');
    await client.deposit(
      merpsGroup,
      merpsAccount,
      payer,
      merpsGroup.tokens[QUOTE_INDEX].rootBank,
      usdcRootBank.nodeBanks?.[0],
      filteredQuoteNodeBanks[0].vault,
      payerQuoteTokenAcc,
      10,
    );
  } catch (err) {
    console.log('Error on deposit', `${err}`);
  }

  let btcOraclePk;
  try {
    console.log('adding oracle');
    btcOraclePk = await Test.createOracle(connection, merpsProgramId, payer);
    await client.addOracle(merpsGroup, btcOraclePk, payer);
  } catch (err) {
    console.log('Error on adding oracle', `${err}`);
  }

  const initLeverage = 5;
  const maintLeverage = initLeverage * 2;
  const marketIndex = 0;
  console.log('adding spot market');
  await client.addSpotMarket(
    merpsGroup,
    btcUsdSpotMarket,
    btcMint,
    payer,
    marketIndex,
    I80F48.fromString(maintLeverage.toString()),
    I80F48.fromString(initLeverage.toString()),
  );

  await sleep(5000); // avoid devnet rate limit
  console.log('adding to basket');

  await client.addToBasket(merpsGroup, merpsAccount, payer, marketIndex);

  merpsGroup = await client.getMerpsGroup(groupKey);
  await sleep(5000); // avoid devnet rate limit

  // run keeper fns
  const cacheRootBanksTxID = await client.cacheRootBanks(
    payer,
    merpsGroup.publicKey,
    merpsGroup.merpsCache,
    [
      merpsGroup.tokens[marketIndex].rootBank,
      merpsGroup.tokens[QUOTE_INDEX].rootBank,
    ],
  );
  console.log('Cache Updated:', cacheRootBanksTxID);

  await client.cachePrices(
    merpsGroup.publicKey,
    merpsGroup.merpsCache,
    [btcOraclePk],
    payer,
  );

  rootBanks = await merpsGroup.loadRootBanks(client.connection);

  console.log('================ loading banks');
  await sleep(5000); // avoid devnet rate limit

  const btcRootBank = rootBanks[marketIndex];
  if (!btcRootBank) throw new Error('no root bank');
  const btcNodeBanks = await btcRootBank.loadNodeBanks(client.connection);
  const filteredBtcNodeBanks = btcNodeBanks.filter((nodeBank) => !!nodeBank);
  if (!filteredBtcNodeBanks[0]) throw new Error('node banks empty');

  console.log('btc root bank:   ', btcRootBank.lastUpdated);

  await sleep(5000); // devnet rate limits
  merpsAccount = await client.getMerpsAccount(merpsAccountPk, dexProgramId);
  const btcSpotMarket = await Market.load(
    connection,
    btcUsdSpotMarket,
    {},
    dexProgramId,
  );

  console.log('placing spot order');
  await client.placeSpotOrder(
    merpsGroup,
    merpsAccount,
    merpsGroup.merpsCache,
    btcSpotMarket,
    payer,
    'buy',
    40000, // price
    1, // size
    'limit',
  );

  // await client.withdraw(
  //   merpsGroup,
  //   merpsAccount,
  //   payer,
  //   merpsGroup.tokens[marketIndex].rootBank,
  //   btcRootBank.nodeBanks?.[0],
  //   filteredBtcNodeBanks[0].vault,
  //   payerBtcTokenAcc,
  //   5,
  //   true, // allow borrow
  // );
}

test();
