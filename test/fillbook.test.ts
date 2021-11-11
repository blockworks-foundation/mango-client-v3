import {
  Cluster,
  Config,
  findLargestTokenAccountForOwner,
  getPerpMarketByIndex,
  NodeBank,
  PerpMarketConfig,
  QUOTE_INDEX,
  RootBank,
} from '../src';
import configFile from '../src/ids.json';
import {
  Account,
  Commitment,
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import fs from 'fs';
import os from 'os';
import { MangoClient } from '../src';
import {
  makeCancelAllPerpOrdersInstruction,
  makePlacePerpOrderInstruction,
  MangoCache,
  sleep,
} from '../src';
import { BN } from 'bn.js';
import MangoAccount from '../src/MangoAccount';

async function fillBook() {
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

  const quoteTokenInfo = mangoGroup.getQuoteTokenInfo();
  const quoteTokenAccount = await findLargestTokenAccountForOwner(
    connection,
    payer.publicKey,
    quoteTokenInfo.mint,
  );
  const rootBank = (await mangoGroup.loadRootBanks(connection))[
    QUOTE_INDEX
  ] as RootBank;
  const nodeBank = rootBank.nodeBankAccounts[0] as NodeBank;
  const cache = await mangoGroup.loadCache(connection);
  // for (let i = 0; i < 3; i++) {
  //   const mangoAccountStr = await client.initMangoAccountAndDeposit(
  //     mangoGroup,
  //     payer,
  //     quoteTokenInfo.rootBank,
  //     nodeBank.publicKey,
  //     nodeBank.vault,
  //     quoteTokenAccount.publicKey,
  //     1000,
  //     `testfunding${i}`,
  //   );
  //   const mangoAccountPk = new PublicKey(mangoAccountStr);
  //   const mangoAccount = await client.getMangoAccount(
  //     mangoAccountPk,
  //     mangoGroup.dexProgramId,
  //   );
  //   for (let j = 0; j < 1; j++) {
  //     for (let k = 0; k < 32; k++) {
  //       const tx = new Transaction();
  //
  //       const [nativeBidPrice, nativeBidSize] =
  //         perpMarket.uiToNativePriceQuantity(100000, 0.0001);
  //       const [nativeAskPrice, nativeAskSize] =
  //         perpMarket.uiToNativePriceQuantity(1, 0.0001);
  //
  //       const placeBidInstruction = makePlacePerpOrderInstruction(
  //         mangoProgramId,
  //         mangoGroup.publicKey,
  //         mangoAccount.publicKey,
  //         payer.publicKey,
  //         mangoGroup.mangoCache,
  //         perpMarket.publicKey,
  //         perpMarket.bids,
  //         perpMarket.asks,
  //         perpMarket.eventQueue,
  //         mangoAccount.getOpenOrdersKeysInBasket(),
  //         nativeBidPrice,
  //         nativeBidSize,
  //         new BN(Date.now()),
  //         'buy',
  //         'postOnlySlide',
  //       );
  //       tx.add(placeBidInstruction);
  //       const placeAskInstruction = makePlacePerpOrderInstruction(
  //         mangoProgramId,
  //         mangoGroup.publicKey,
  //         mangoAccount.publicKey,
  //         payer.publicKey,
  //         mangoGroup.mangoCache,
  //         perpMarket.publicKey,
  //         perpMarket.bids,
  //         perpMarket.asks,
  //         perpMarket.eventQueue,
  //         mangoAccount.getOpenOrdersKeysInBasket(),
  //         nativeAskPrice,
  //         nativeAskSize,
  //         new BN(Date.now()),
  //         'sell',
  //         'postOnlySlide',
  //       );
  //       tx.add(placeAskInstruction);
  //       // const txid = await client.sendTransaction(tx, payer, []);
  //     }
  //   }
  // }
  const fundingTxid = await client.updateFunding(
    mangoGroup.publicKey,
    mangoGroup.mangoCache,
    perpMarket.publicKey,
    perpMarket.bids,
    perpMarket.asks,
    payer,
  );
  console.log(`fundingTxid: ${fundingTxid.toString()}`);
}
fillBook();
