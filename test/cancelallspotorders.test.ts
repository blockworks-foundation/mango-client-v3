import fs from 'fs';
import os from 'os';
import { Cluster, Config, MangoClient, QUOTE_INDEX, sleep } from '../src';
import configFile from '../src/ids.json';
import { Commitment, Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import TestGroup from './TestGroup';
import * as serum from '@project-serum/serum';
import * as pyth from "@pythnetwork/client";
import { expect } from 'chai';

async function testCancelAllSpotOrders() {
  const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
  const sleepTime = 2000;
  const config = new Config(configFile);
  const groupConfig = config.getGroup(cluster, 'devnet.2')!;
  const mangoProgramId = groupConfig.mangoProgramId;
  const mangoGroupKey = groupConfig.publicKey;
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
  //const testGroup = new TestGroup(connection, payer, mangoProgramId);
  const client = new MangoClient(connection, mangoProgramId);
  const mangoGroup = await client.getMangoGroup(mangoGroupKey);

  const cache = await mangoGroup.loadCache(connection);
  const rootBanks = await mangoGroup.loadRootBanks(connection);
  const quoteRootBank = rootBanks[QUOTE_INDEX];
  if (!quoteRootBank) {
    throw new Error('Quote Rootbank Not Found');
  }
  const quoteNodeBanks = await quoteRootBank.loadNodeBanks(connection);

  const accountPk: PublicKey = (await client.createMangoAccount(
    mangoGroup,
    payer,
    1,
  ))!;
  console.log('Created Account:', accountPk.toBase58());

  await sleep(sleepTime);
  const mangoAccount = await client.getMangoAccount(
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

  await client.deposit(
    mangoGroup,
    mangoAccount,
    payer,
    quoteRootBank.publicKey,
    quoteNodeBanks[0].publicKey,
    quoteNodeBanks[0].vault,
    quoteWallet.address,
    10000,
  );

  await sleep(sleepTime);

  const marketPk = mangoGroup.spotMarkets[3].spotMarket;
  const market = await serum.Market.load(connection, marketPk, undefined, groupConfig.serumProgramId);
  const oracle = mangoGroup.oracles[3];
  
  await mangoAccount.reload(connection);
  const oracleData = await connection.getAccountInfo(oracle);
  if(oracleData == null)
    return;
  // determine asset price
  const price = pyth.parsePriceData(oracleData?.data);
  const assetPrice = price!.price;
  console.log('asset price is ' + assetPrice)

  // Buy some spot to create sell instructions later
  {
    await client.placeSpotOrder(mangoGroup, mangoAccount, mangoGroup.mangoCache, market, payer, "buy", assetPrice ?? 0 * 1.05, 1, 'limit');
    const consumeItx = market.makeConsumeEventsInstruction(mangoAccount.spotOpenOrders, 10);
    const trx = new Transaction();
    trx.add(consumeItx);
    await client.sendTransaction(trx, payer, []);
    await mangoAccount.reload(connection);
  }
  
  // placing orders
  console.log('place order 1')
  await client.placeSpotOrder(mangoGroup, mangoAccount, mangoGroup.mangoCache, market, payer, "buy", assetPrice ?? 0 * 0.99, 1, 'limit');
  await mangoAccount.reload(connection);
  console.log('place order 2')
  await client.placeSpotOrder(mangoGroup, mangoAccount, mangoGroup.mangoCache, market, payer, "sell", assetPrice ?? 0 * 1.02, 1, 'limit');
  // checking open orders length
  {
    const orders = await mangoAccount.loadSpotOrdersForMarket(connection, market, 3)
    expect( orders.length === 2 );
    console.log("Number of orders placed are : " + orders.length)
  }
  // canceling all spot orders for a market
  console.log("Cancel All Spot Orders");
  const signature = await client.cancelAllSpotOrders(mangoGroup, mangoAccount, market, payer, 255);
  console.log("cancel all spot orders signature " + signature)
  
  await sleep(sleepTime);
  {
    const orders = await mangoAccount.loadSpotOrdersForMarket(connection, market, 3)
    expect( orders.length === 0 );
    console.log("Number of orders placed are : " + orders.length)
  }
}

testCancelAllSpotOrders()