import {
  Config,
  getMarketByBaseSymbolAndKind,
  GroupConfig,
  I64_MAX_BN,
  makeCancelAllPerpOrdersInstruction,
  makePlacePerpOrder2Instruction,
  MangoClient,
} from '../src';
import {
  Account,
  Commitment,
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import configFile from '../src/ids.json';
import * as os from 'os';
import * as fs from 'fs';
import { BN } from 'bn.js';

async function atomicCancelReplace() {
  // setup client
  const config = new Config(configFile);
  const groupConfig = config.getGroupWithName('mainnet.1') as GroupConfig;
  const connection = new Connection(
    config.cluster_urls[groupConfig.cluster],
    'processed' as Commitment,
  );
  const client = new MangoClient(connection, groupConfig.mangoProgramId);

  const payer = new Account(
    JSON.parse(
      fs.readFileSync(
        os.homedir() + '/.config/solana/my-mainnet.json',
        'utf-8',
      ),
    ),
  );

  // load group, account, market
  const mangoAccountPk = new PublicKey('YOUR_MANGOACCOUNT_KEY');
  const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);
  const mangoAccount = await client.getMangoAccount(
    mangoAccountPk,
    mangoGroup.dexProgramId,
  );

  const perpMarketConfig = getMarketByBaseSymbolAndKind(
    groupConfig,
    'BTC',
    'perp',
  );

  const perpMarket = await mangoGroup.loadPerpMarket(
    connection,
    perpMarketConfig.marketIndex,
    perpMarketConfig.baseDecimals,
    perpMarketConfig.quoteDecimals,
  );

  const tx = new Transaction();

  // add cancel all instruction
  tx.add(
    makeCancelAllPerpOrdersInstruction(
      groupConfig.mangoProgramId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      payer.publicKey,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      new BN(20),
    ),
  );

  // add place bid instruction
  // use best price
  const bids = await perpMarket.loadBids(connection);
  const bidPrice = bids.getBest().price;

  const [nativeBidPrice, nativeBidQuantity] =
    perpMarket.uiToNativePriceQuantity(bidPrice, 0.1);

  tx.add(
    makePlacePerpOrder2Instruction(
      groupConfig.mangoProgramId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      payer.publicKey,
      mangoGroup.mangoCache,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      perpMarket.eventQueue,
      mangoAccount.getOpenOrdersKeysInBasketPacked(),
      nativeBidPrice,
      nativeBidQuantity,
      I64_MAX_BN,
      new BN(0),
      'buy',
      new BN(20),
      'postOnly',
      false,
    ),
  );

  // add place ask instruction
  // use best price
  const asks = await perpMarket.loadAsks(connection);
  const askPrice = asks.getBest().price;

  const [nativeAskPrice, nativeAskQuantity] =
    perpMarket.uiToNativePriceQuantity(askPrice, 0.1);

  tx.add(
    makePlacePerpOrder2Instruction(
      groupConfig.mangoProgramId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      payer.publicKey,
      mangoGroup.mangoCache,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      perpMarket.eventQueue,
      mangoAccount.getOpenOrdersKeysInBasketPacked(),
      nativeAskPrice,
      nativeAskQuantity,
      I64_MAX_BN,
      new BN(0),
      'sell',
      new BN(20),
      'postOnly',
      false,
    ),
  );

  await client.sendTransaction(tx, payer, []);
}

atomicCancelReplace();
