import fs from 'fs';
import os from 'os';
import { Cluster, Config, QUOTE_INDEX, sleep } from '../src';
import configFile from '../src/ids.json';
import {
  Account,
  Commitment,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import TestGroup from './TestGroup';

async function testStopLoss() {
  const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
  const sleepTime = 2000;
  const config = new Config(configFile);

  const payer = new Account(
    JSON.parse(
      process.env.KEYPAIR ||
        fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
    ),
  );
  const connection = new Connection(
    config.cluster_urls[cluster],
    'processed' as Commitment,
  );

  const testGroup = new TestGroup();
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

  const accountPk = await testGroup.client.initMangoAccount(mangoGroup, payer);
  console.log('Created Account:', accountPk.toBase58());
  await sleep(sleepTime);
  const account = await testGroup.client.getMangoAccount(
    accountPk,
    mangoGroup.dexProgramId,
  );

  const quoteTokenInfo = mangoGroup.tokens[QUOTE_INDEX];
  const rayToken = new Token(
    connection,
    quoteTokenInfo.mint,
    TOKEN_PROGRAM_ID,
    payer,
  );
  const quoteWallet = await rayToken.getOrCreateAssociatedAccountInfo(
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
    1000,
  );

  await testGroup.runKeeper();

  const makerPk = await testGroup.client.initMangoAccount(mangoGroup, payer);
  console.log('Created Maker:', accountPk.toBase58());
  await sleep(sleepTime);
  const maker = await testGroup.client.getMangoAccount(
    makerPk,
    mangoGroup.dexProgramId,
  );

  await testGroup.runKeeper();
  await testGroup.client.deposit(
    mangoGroup,
    maker,
    payer,
    quoteRootBank.publicKey,
    quoteNodeBanks[0].publicKey,
    quoteNodeBanks[0].vault,
    quoteWallet.address,
    10000,
  );

  await testGroup.runKeeper();

  // Get a position on the perps
  console.log('placing maker order');
  await testGroup.client.placePerpOrder(
    mangoGroup,
    maker,
    mangoGroup.mangoCache,
    perpMarkets[0],
    payer,
    'buy',
    50000,
    0.01,
    'limit',
  );

  await testGroup.runKeeper();

  // Get a position on the perps
  console.log('placing taker order');
  await testGroup.client.placePerpOrder(
    mangoGroup,
    account,
    mangoGroup.mangoCache,
    perpMarkets[0],
    payer,
    'sell',
    50000,
    0.001,
    'market',
  );

  await testGroup.runKeeper();
  await sleep(2000);
  await account.reload(testGroup.connection);
  await maker.reload(testGroup.connection);

  console.log('acct base', account.perpAccounts[1].basePosition.toString());
  console.log('acct quote', account.perpAccounts[1].quotePosition.toString());
  console.log('mkr base', maker.perpAccounts[1].basePosition.toString());
  console.log('mkr quote', maker.perpAccounts[1].quotePosition.toString());

  // Add the trigger order, this should be executable immediately
  await sleep(sleepTime);
  const txid = await testGroup.client.addPerpTriggerOrder(
    mangoGroup,
    account,
    perpMarkets[0],
    payer,
    'limit',
    'buy',
    50000,
    0.2276,
    'above',
    51000,
  );
  console.log('add perp trigger order successful', txid.toString());
  const advanced = await account.loadAdvancedOrders(connection);
  console.log(advanced.filter((o) => o.perpTrigger && o.perpTrigger.isActive));

  // Agent trigger the order
  // First create an agent SOL account and fund it
  const agent = new Account();
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: agent.publicKey,
      lamports: 0.1 * LAMPORTS_PER_SOL,
    }),
  );
  await sendAndConfirmTransaction(connection, tx, [payer]);
  await sleep(sleepTime);
  const agentAcc = await connection.getAccountInfo(agent.publicKey);
  console.log(
    'agent:',
    agent.publicKey.toBase58(),
    'sol:',
    agentAcc ? agentAcc.lamports / LAMPORTS_PER_SOL : 0,
  );
  await testGroup.setOracle(1, 51001);
  await testGroup.runKeeper();

  // Now trigger the order
  console.log('execute order');
  await testGroup.client.executePerpTriggerOrder(
    mangoGroup,
    account,
    cache,
    perpMarkets[0],
    agent,
    0,
  );
  await testGroup.runKeeper();
  await account.reload(testGroup.connection, testGroup.serumProgramId);
  console.log(
    'health',
    account.getHealthRatio(mangoGroup, cache, 'Maint').toString(),
  );

  const openOrders = await perpMarkets[0].loadOrdersForAccount(
    connection,
    account,
  );
  console.log('open orders');
  for (const oo of openOrders) {
    console.log(oo);
  }

  console.log('bids and asks');
  const asks = await await perpMarkets[0].loadAsks(connection);
  const bids = await await perpMarkets[0].loadBids(connection);
  console.log([...asks]);
  console.log([...bids]);
}

testStopLoss();
