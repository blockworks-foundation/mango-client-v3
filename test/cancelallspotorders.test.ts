import fs from 'fs';
import os from 'os';
import { Cluster, Config, QUOTE_INDEX, sleep } from '../src';
import configFile from '../src/ids.json';
import { Commitment, Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import TestGroup from './TestGroup';
import * as serum from '@project-serum/serum';
import * as pyth from "@pythnetwork/client";
import { expect } from 'chai';
import BN from 'bn.js';

async function testCancelAllSpotOrders() {
  const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
  const sleepTime = 2000;
  const config = new Config(configFile);
  const mangoProgramId = config.getGroup(cluster, 'devnet.2')!.mangoProgramId;
  const serumProgramId = config.getGroup(cluster, 'devnet.2')!.serumProgramId;
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
  // init
  const testGroup = new TestGroup(connection, payer, mangoProgramId);
  const mangoGroupKey = await testGroup.init();
``
  const mangoGroup = await testGroup.client.getMangoGroup(mangoGroupKey);

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
  const mangoAccount = await testGroup.client.getMangoAccount(
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
    mangoAccount,
    payer,
    quoteRootBank.publicKey,
    quoteNodeBanks[0].publicKey,
    quoteNodeBanks[0].vault,
    quoteWallet.address,
    10000,
  );
  await testGroup.runKeeper();
  await testGroup.updateCache();
  
  await sleep(sleepTime);

  const market = testGroup.spotMarkets[3];
  const oracle = testGroup.oraclePks[3];
  
  await mangoAccount.reload(connection);
  const oracleData = await connection.getAccountInfo(oracle);
  if(oracleData == null)
    return;
  // placing orders
  const price = pyth.parsePriceData(oracleData?.data);
  const assetPrice = price?.price;
  console.log('asset price is ' + assetPrice)
  console.log('place order 1')
  await testGroup.client.placeSpotOrder(mangoGroup, mangoAccount, mangoGroup.mangoCache, market, payer, "buy", assetPrice ?? 0 * 0.99, 1, 'limit');
  await mangoAccount.reload(connection);
  console.log('place order 2')
  await testGroup.client.placeSpotOrder(mangoGroup, mangoAccount, mangoGroup.mangoCache, market, payer, "buy", assetPrice ?? 0 * 0.98, 1, 'limit');
  // checking open orders length
  {
    const orders = await mangoAccount.loadSpotOrdersForMarket(connection, market, 3)
    expect( orders.length === 2 );
    console.log("Number of orders placed are : " + orders.length)
  }
  // canceling all spot orders for a market
  console.log("Cancel All Spot Orders");
  const signature = await testGroup.client.cancelAllSpotOrders(mangoGroup, mangoAccount, market, payer, 255);
  console.log("cancel all spot orders signature " + signature)
  
  await testGroup.runKeeper();
  await sleep(sleepTime);
  
  {
    const orders = await mangoAccount.loadSpotOrdersForMarket(connection, market, 3)
    expect( orders.length === 0 );
    console.log("Number of orders placed are : " + orders.length)
  }
}

testCancelAllSpotOrders()