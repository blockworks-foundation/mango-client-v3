import fs from 'fs';
import os from 'os';
import { Cluster, Config, QUOTE_INDEX, sleep } from '../src';
import configFile from '../src/ids.json';
import { Commitment, Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import TestGroup from './TestGroup';
import { Market } from '@project-serum/serum';
import { Order } from '@project-serum/serum/lib/market';

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
  const testGroup = new TestGroup(connection, payer, mangoProgramId);
  const mangoGroupKey = await testGroup.init();

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
  console.log('loading bids');
  const market = testGroup.spotMarkets[0];
  console.log('place order 1')
  await testGroup.client.placeSpotOrder(mangoGroup, account, mangoGroup.mangoCache, market, payer, "buy", 1, 100, 'limit');
  console.log('place order 2')
  await testGroup.client.placeSpotOrder(mangoGroup, account, mangoGroup.mangoCache, market, payer, "buy", 2, 100, 'limit');

  const bids = await market.loadBids(connection);
  const last_bid = bids.items().next()
  if(last_bid.done)
  {
    const val: Order = last_bid.value;
    console.log('last_bids ' + val.price + " , " + val.size, " , " + val.side, )
  }
}

testCancelAllSpotOrders()