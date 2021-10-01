import {
  Cluster,
  Config,
  getPerpMarketByIndex,
  PerpMarketConfig,
} from './config';
import configFile from './ids.json';
import {
  Account,
  Commitment,
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import fs from 'fs';
import os from 'os';
import { MangoClient } from './client';
import {
  makeCancelAllPerpOrdersInstruction,
  makePlacePerpOrderInstruction,
  MangoCache,
  sleep,
} from './index';
import { BN } from 'bn.js';
import MangoAccount from './MangoAccount';

async function mm() {
  // load mango group and clients
  const config = new Config(configFile);
  const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
  const groupName = process.env.GROUP || 'devnet.2';
  const groupIds = config.getGroup(cluster, groupName);
  if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
  }

  const mangoProgramId = groupIds.mangoProgramId;
  const mangoGroupKey = groupIds.publicKey;

  const payer = new Account(
    JSON.parse(
      fs.readFileSync(
        process.env.KEYPAIR || os.homedir() + '/.config/solana/id.json',
        'utf-8',
      ),
    ),
  );
  console.log(`Payer: ${payer.publicKey.toBase58()}`);

  const connection = new Connection(
    process.env.ENDPOINT_URL || config.cluster_urls[cluster],
    'processed' as Commitment,
  );
  const client = new MangoClient(connection, mangoProgramId);

  const mangoGroup = await client.getMangoGroup(mangoGroupKey);

  // TODO make it fetch all mango accounts for owner and select highest value one
  const mangoAccountPk = new PublicKey(
    'FG99s25HS1UKcP1jMx72Gezg6KZCC7DuKXhNW51XC1qi',
  );

  // while true loop with try catch inside
  // periodically check staleness
  // periodically receive fresh OB and mango account state
  // periodically

  // TODO make it be able to quote all markets
  const marketIndex = 1;
  const perpMarketConfig = getPerpMarketByIndex(
    groupIds,
    marketIndex,
  ) as PerpMarketConfig;
  const perpMarket = await client.getPerpMarket(
    perpMarketConfig.publicKey,
    perpMarketConfig.baseDecimals,
    perpMarketConfig.quoteDecimals,
  );

  process.on('SIGINT', function () {
    console.log('Caught keyboard interrupt. Canceling orders');
    process.exit();
  });

  const interval = 10000;
  const sizePerc = 0.1;
  const charge = 0.0005;
  const leanCoeff = 0.0005;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // get fresh data
      // get orderbooks, get perp markets, caches
      // TODO load pyth oracle for most accurate prices
      const [mangoCache, mangoAccount]: [MangoCache, MangoAccount] =
        await Promise.all([
          // perpMarket.loadBids(connection),
          // perpMarket.loadAsks(connection),
          mangoGroup.loadCache(connection),
          client.getMangoAccount(mangoAccountPk, mangoGroup.dexProgramId),
        ]);

      // TODO store the prices in an array to calculate volatility

      // Model logic
      const fairValue = mangoGroup.getPrice(marketIndex, mangoCache).toNumber();
      const equity = mangoAccount
        .computeValue(mangoGroup, mangoCache)
        .toNumber();
      const perpAccount = mangoAccount.perpAccounts[marketIndex];
      // TODO look at event queue as well for unprocessed fills
      const basePos = perpAccount.getBasePositionUi(perpMarket);

      // TODO volatility adjustment
      const size = (equity * sizePerc) / fairValue;
      const lean = (-leanCoeff * basePos) / size;
      const bidPrice = fairValue * (1 - charge + lean);
      const askPrice = fairValue * (1 + charge + lean);

      // TODO only requote if new prices significantly different from current
      const [nativeBidPrice, nativeBidSize] =
        perpMarket.uiToNativePriceQuantity(bidPrice, size);
      const [nativeAskPrice, nativeAskSize] =
        perpMarket.uiToNativePriceQuantity(askPrice, size);

      // cancel all, requote
      const cancelAllInstr = makeCancelAllPerpOrdersInstruction(
        mangoProgramId,
        mangoGroup.publicKey,
        mangoAccount.publicKey,
        payer.publicKey,
        perpMarket.publicKey,
        perpMarket.bids,
        perpMarket.asks,
        new BN(20),
      );

      const placeBidInstr = makePlacePerpOrderInstruction(
        mangoProgramId,
        mangoGroup.publicKey,
        mangoAccount.publicKey,
        payer.publicKey,
        mangoCache.publicKey,
        perpMarket.publicKey,
        perpMarket.bids,
        perpMarket.asks,
        perpMarket.eventQueue,
        mangoAccount.getOpenOrdersKeysInBasket(),
        nativeBidPrice,
        nativeBidSize,
        new BN(Date.now()),
        'buy',
        'postOnlySlide',
      );

      const placeAskInstruction = makePlacePerpOrderInstruction(
        mangoProgramId,
        mangoGroup.publicKey,
        mangoAccount.publicKey,
        payer.publicKey,
        mangoCache.publicKey,
        perpMarket.publicKey,
        perpMarket.bids,
        perpMarket.asks,
        perpMarket.eventQueue,
        mangoAccount.getOpenOrdersKeysInBasket(),
        nativeAskPrice,
        nativeAskSize,
        new BN(Date.now()),
        'sell',
        'postOnlySlide',
      );
      const tx = new Transaction();
      tx.add(cancelAllInstr);
      tx.add(placeBidInstr);
      tx.add(placeAskInstruction);

      const txid = await client.sendTransaction(tx, payer, []);
      console.log(`quoting successful: ${txid.toString()}`);
    } catch (e) {
      // TODO on keyboard interrupt cancel all and exit
      // sleep for some time and retry
      console.log(e);
    } finally {
      console.log(`sleeping for ${interval / 1000}s`);
      await sleep(interval);
    }
  }
}

mm();
