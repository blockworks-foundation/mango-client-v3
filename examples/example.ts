import * as os from 'os';
import * as fs from 'fs';
import {
  Config,
  getMarketByBaseSymbolAndKind,
  getUnixTs,
  GroupConfig,
  MangoClient,
  ZERO_BN,
} from '../src';
import { Keypair, Commitment, Connection } from '@solana/web3.js';
import configFile from '../src/ids.json';
import { Market } from '@project-serum/serum';

function readKeypair() {
  return JSON.parse(
    process.env.KEYPAIR ||
      fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
  );
}

async function examplePerp() {
  // setup client
  const config = new Config(configFile);
  const groupConfig = config.getGroupWithName('devnet.2') as GroupConfig;
  const connection = new Connection(
    config.cluster_urls[groupConfig.cluster],
    'processed' as Commitment,
  );
  const client = new MangoClient(connection, groupConfig.mangoProgramId);

  // load group & market
  const perpMarketConfig = getMarketByBaseSymbolAndKind(
    groupConfig,
    'BTC',
    'perp',
  );
  const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);
  const perpMarket = await mangoGroup.loadPerpMarket(
    connection,
    perpMarketConfig.marketIndex,
    perpMarketConfig.baseDecimals,
    perpMarketConfig.quoteDecimals,
  );

  // Fetch orderbooks
  const bids = await perpMarket.loadBids(connection);
  const asks = await perpMarket.loadAsks(connection);

  // L2 orderbook data
  for (const [price, size] of bids.getL2(20)) {
    console.log(price, size);
  }

  // L3 orderbook data
  for (const order of asks) {
    console.log(
      order.owner.toBase58(),
      order.orderId.toString('hex'),
      order.price,
      order.size,
      order.side, // 'buy' or 'sell'
    );
  }

  // Place order
  const owner = Keypair.fromSecretKey(Uint8Array.from(readKeypair()));
  const mangoAccount = (
    await client.getMangoAccountsForOwner(mangoGroup, owner.publicKey)
  )[0];

  // Place an order that is guaranteed to go on the book and let it auto expire in 5 seconds
  await client.placePerpOrder2(
    mangoGroup,
    mangoAccount,
    perpMarket,
    owner,
    'buy', // or 'sell'
    39000,
    0.0001,
    { orderType: 'postOnlySlide', expiryTimestamp: getUnixTs() + 5 },
  ); // or 'ioc' or 'postOnly'

  // retrieve open orders for account
  const openOrders = await perpMarket.loadOrdersForAccount(
    connection,
    mangoAccount,
  );

  // cancel orders
  for (const order of openOrders) {
    await client.cancelPerpOrder(
      mangoGroup,
      mangoAccount,
      owner,
      perpMarket,
      order,
    );
  }

  // Retrieve fills
  for (const fill of await perpMarket.loadFills(connection)) {
    console.log(
      fill.maker.toBase58(),
      fill.taker.toBase58(),
      fill.price,
      fill.quantity,
    );
  }
}

async function exampleSpot() {
  // setup client
  const config = new Config(configFile);
  const groupConfig = config.getGroup(
    'devnet',
    'mango_test_v2.2',
  ) as GroupConfig;
  const connection = new Connection(
    'https://api.devnet.solana.com',
    'processed' as Commitment,
  );
  const client = new MangoClient(connection, groupConfig.mangoProgramId);

  // load group & market
  const spotMarketConfig = getMarketByBaseSymbolAndKind(
    groupConfig,
    'BTC',
    'spot',
  );
  const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);
  const spotMarket = await Market.load(
    connection,
    spotMarketConfig.publicKey,
    undefined,
    groupConfig.serumProgramId,
  );

  // Fetch orderbooks
  let bids = await spotMarket.loadBids(connection);
  let asks = await spotMarket.loadAsks(connection);

  // L2 orderbook data
  for (const [price, size] of bids.getL2(20)) {
    console.log(price, size);
  }

  // L3 orderbook data
  for (const order of asks) {
    console.log(
      order.openOrdersAddress.toBase58(),
      order.orderId.toString('hex'),
      order.price,
      order.size,
      order.side, // 'buy' or 'sell'
    );
  }

  // Place order
  const owner = Keypair.fromSecretKey(Uint8Array.from(readKeypair()));
  const mangoAccount = (
    await client.getMangoAccountsForOwner(mangoGroup, owner.publicKey)
  )[0];
  await client.placeSpotOrder2(
    mangoGroup,
    mangoAccount,
    spotMarket,
    owner,
    'buy', // or 'sell'
    41000,
    0.0001,
    'limit',
    ZERO_BN, // client order id, set to whatever you want
    true, // use the mango MSRM vault for fee discount
  ); // or 'ioc' or 'postOnly'

  // Reload bids and asks and find your open orders
  // Possibly have a wait here so RPC node can catch up
  const openOrders = await mangoAccount.loadSpotOrdersForMarket(
    connection,
    spotMarket,
    spotMarketConfig.marketIndex,
  );

  // cancel orders
  for (const order of openOrders) {
    await client.cancelSpotOrder(
      mangoGroup,
      mangoAccount,
      owner,
      spotMarket,
      order,
    );
  }

  // Retrieve fills
  for (const fill of await spotMarket.loadFills(connection)) {
    console.log(
      fill.openOrders.toBase58(),
      fill.eventFlags.maker ? 'maker' : 'taker',
      fill.size * (fill.side === 'buy' ? 1 : -1),
      spotMarket.quoteSplSizeToNumber(
        fill.side === 'buy'
          ? fill.nativeQuantityPaid
          : fill.nativeQuantityReleased,
      ),
    );
  }

  // Settle funds
  for (const openOrders of await mangoAccount.loadOpenOrders(
    connection,
    groupConfig.serumProgramId,
  )) {
    if (!openOrders) continue;

    if (
      openOrders.baseTokenFree.gt(ZERO_BN) ||
      openOrders.quoteTokenFree.gt(ZERO_BN)
    ) {
      await client.settleFunds(mangoGroup, mangoAccount, owner, spotMarket);
    }
  }
}

examplePerp();
exampleSpot();
