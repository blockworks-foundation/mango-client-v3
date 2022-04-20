import fs from 'fs';
import os from 'os';
import { Cluster, Config, QUOTE_INDEX, sleep } from '../src';
import configFile from '../src/ids.json';
import { Commitment, Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import TestGroup from './TestGroup';

async function testCancelSide() {
  const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
  const sleepTime = 2000;
  const config = new Config(configFile);
  const mangoProgramId = config.getGroup(cluster, 'devnet.2')!.mangoProgramId;
  const payer = Keypair.fromSecretKey(
    new Uint8Array(
      JSON.parse(
        process.env.KEYPAIR ||
          fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
      ),
    )
  );
  const connection = new Connection(
    config.cluster_urls[cluster],
    'processed' as Commitment,
  );

  const testGroup = new TestGroup(connection, payer, mangoProgramId);
  const mangoGroupKey = await testGroup.init();
  const mangoGroup = await testGroup.client.getMangoGroup(mangoGroupKey);
  const perpMarkets = await Promise.all(
    [1, 3].map((marketIndex) => {
      return mangoGroup.loadPerpMarket(connection, marketIndex, 6, 6);
    }),
  );

  const cache = await mangoGroup.loadCache(connection);
  const rootBanks = await mangoGroup.loadRootBanks(connection);
  const quoteRootBank = rootBanks[QUOTE_INDEX];
  if (!quoteRootBank) {
    throw new Error('Quote Rootbank Not Found');
  }
  const quoteNodeBanks = await quoteRootBank.loadNodeBanks(connection);

  const accountPk: PublicKey = (await testGroup.client.createMangoAccount(
    mangoGroup,
    payer,
    1,
  ))!;
  console.log('Created Account:', accountPk.toBase58());

  await sleep(sleepTime);
  const account = await testGroup.client.getMangoAccount(
    accountPk,
    mangoGroup.dexProgramId,
  );

  const quoteTokenInfo = mangoGroup.tokens[QUOTE_INDEX];
  const quoteToken = new Token(
    connection,
    quoteTokenInfo.mint,
    TOKEN_PROGRAM_ID,
    payer,
  );
  const quoteWallet = await quoteToken.getOrCreateAssociatedAccountInfo(
    payer.publicKey,
  );

  await testGroup.runKeeper();
  await testGroup.client.deposit(
    mangoGroup,
    account,
    payer,
    quoteRootBank.publicKey,
    quoteNodeBanks[0].publicKey,
    quoteNodeBanks[0].vault,
    quoteWallet.address,
    10000,
  );

  console.log('changeParams');
  const info = mangoGroup.perpMarkets[1];
  await testGroup.client.changePerpMarketParams2(
    mangoGroup,
    perpMarkets[0],
    payer,
    20,
    10,
    info.liquidationFee.toNumber(),
    info.makerFee.toNumber(),
    info.takerFee.toNumber(),
    1,
    200,
    3601,
    0,
    2,
    1,
    0,
  );

  await testGroup.runKeeper();

  console.log('placePerpBid');
  await testGroup.client.placePerpOrder(
    mangoGroup,
    account,
    cache.publicKey,
    perpMarkets[0],
    payer,
    'buy',
    1,
    1,
  );

  await testGroup.runKeeper();

  await account.reload(testGroup.connection);
  let pm = await mangoGroup.loadPerpMarket(testGroup.connection, 1, 6, 6);
  let bids = await pm.loadBids(testGroup.connection);
  console.log('bids', [...bids].length);

  console.log('cancelPerpBids');
  await testGroup.client.cancelPerpOrderSide(
    mangoGroup,
    account,
    pm,
    payer,
    'buy',
    1,
  );

  await account.reload(testGroup.connection);
  pm = await mangoGroup.loadPerpMarket(testGroup.connection, 1, 6, 6);
  bids = await pm.loadBids(testGroup.connection);
  console.log('bids', [...bids].length);

  console.log('placePerpAsk');
  await testGroup.client.placePerpOrder(
    mangoGroup,
    account,
    cache.publicKey,
    perpMarkets[0],
    payer,
    'sell',
    100000,
    1,
  );

  await testGroup.runKeeper();

  await account.reload(testGroup.connection);
  pm = await mangoGroup.loadPerpMarket(testGroup.connection, 1, 6, 6);
  let asks = await pm.loadAsks(testGroup.connection);
  console.log('asks', [...asks].length);

  console.log('cancelPerpAsks');
  await testGroup.client.cancelPerpOrderSide(
    mangoGroup,
    account,
    pm,
    payer,
    'sell',
    1,
  );

  await account.reload(testGroup.connection);
  pm = await mangoGroup.loadPerpMarket(testGroup.connection, 1, 6, 6);
  asks = await pm.loadAsks(testGroup.connection);
  console.log('asks', [...asks].length);
}

testCancelSide();
