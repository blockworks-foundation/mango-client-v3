import * as os from 'os';
import * as fs from 'fs';
import { MerpsClient } from './client';
import {
  Account,
  Commitment,
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { sleep } from './utils';
import configFile from './ids.json';
import {
  Cluster,
  Config,
  getMarketByBaseSymbolAndKind,
  GroupConfig,
} from './config';
import { QUOTE_INDEX } from '../src/MerpsGroup';
import {
  makeCachePerpMarketsInstruction,
  makeCachePricesInstruction,
  makeCacheRootBankInstruction,
  makeUpdateFundingInstruction,
  makeUpdateRootBankInstruction,
} from './instruction';
import BN from 'bn.js';
import { Market } from '@project-serum/serum';

function readKeypair() {
  return JSON.parse(
    process.env.KEYPAIR ||
      fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
  );
}

async function example() {
  // setup client
  const config = new Config(configFile);
  const groupConfig = config.getGroup(
    'devnet',
    'merps_test_v2.2',
  ) as GroupConfig;
  const connection = new Connection(
    'https://api.devnet.solana.com',
    'processed' as Commitment,
  );
  const client = new MerpsClient(connection, groupConfig.merpsProgramId);

  // load group & market
  const perpMarketConfig = getMarketByBaseSymbolAndKind(
    groupConfig,
    'BTC',
    'perp',
  );
  const merpsGroup = await client.getMerpsGroup(groupConfig.publicKey);
  const perpMarket = await merpsGroup.loadPerpMarket(
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
  const owner = new Account(readKeypair());
  const mangoAccount = (
    await client.getMarginAccountsForOwner(merpsGroup, owner.publicKey)
  )[0];
  await client.placePerpOrder(
    merpsGroup,
    mangoAccount,
    merpsGroup.merpsCache,
    perpMarket,
    owner,
    'buy', // or 'sell'
    39000,
    0.0001,
    'limit',
  ); // or 'ioc' or 'postOnly'

  // retrieve open orders for account
  const openOrders = await perpMarket.loadOrdersForAccount(
    connection,
    mangoAccount,
  );

  // cancel orders
  for (const order of openOrders) {
    await client.cancelPerpOrder(
      merpsGroup,
      mangoAccount,
      owner,
      perpMarket,
      order,
    );
  }

  // Retrieve fills
  for (const fill of await perpMarket.loadFills(connection)) {
    console.log(
      fill.owner.toBase58(),
      fill.maker ? 'maker' : 'taker',
      fill.baseChange.toNumber(),
      fill.quoteChange.toNumber(),
      fill.longFunding.toFixed(3),
      fill.shortFunding.toFixed(3),
    );
  }
}

example();
