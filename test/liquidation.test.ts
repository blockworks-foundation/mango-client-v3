import fs from 'fs';
import os from 'os';
import {
  Cluster,
  Config,
  MangoClient,
  MAX_PAIRS,
  sleep,
  throwUndefined,
  MAX_NUM_IN_MARGIN_BASKET,
  QUOTE_INDEX,
  AssetType,
  I80F48,
} from '../src';
import configFile from '../src/ids.json';
import { Account, Commitment, Connection } from '@solana/web3.js';
import { Market } from '@project-serum/serum';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import TestGroup from './TestGroup';

async function testPerpLiquidationAndBankruptcy() {
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

  let cache = await mangoGroup.loadCache(connection);
  const rootBanks = await mangoGroup.loadRootBanks(connection);
  const quoteRootBank = rootBanks[QUOTE_INDEX];
  if (!quoteRootBank) {
    throw new Error('Quote Rootbank Not Found');
  }
  const quoteNodeBanks = await quoteRootBank.loadNodeBanks(connection);
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

  const liqorPk = await testGroup.client.initMangoAccount(mangoGroup, payer);
  const liqorAccount = await testGroup.client.getMangoAccount(
    liqorPk,
    mangoGroup.dexProgramId,
  );
  console.log('Created Liqor:', liqorPk.toBase58());

  const liqeePk = await testGroup.client.initMangoAccount(mangoGroup, payer);
  const liqeeAccount = await testGroup.client.getMangoAccount(
    liqeePk,
    mangoGroup.dexProgramId,
  );
  console.log('Created Liqee:', liqeePk.toBase58());

  await testGroup.runKeeper();
  await testGroup.client.deposit(
    mangoGroup,
    liqorAccount,
    payer,
    quoteRootBank.publicKey,
    quoteNodeBanks[0].publicKey,
    quoteNodeBanks[0].vault,
    quoteWallet.address,
    1000,
  );
  await testGroup.client.deposit(
    mangoGroup,
    liqeeAccount,
    payer,
    quoteRootBank.publicKey,
    quoteNodeBanks[0].publicKey,
    quoteNodeBanks[0].vault,
    quoteWallet.address,
    10,
  );
  await testGroup.runKeeper();

  console.log('Placing maker order');
  await testGroup.client.placePerpOrder(
    mangoGroup,
    liqorAccount,
    mangoGroup.mangoCache,
    perpMarkets[0],
    payer,
    'sell',
    45000,
    0.0111,
    'limit',
  );
  await testGroup.runKeeper();

  console.log('Placing taker order');
  await testGroup.client.placePerpOrder(
    mangoGroup,
    liqeeAccount,
    mangoGroup.mangoCache,
    perpMarkets[0],
    payer,
    'buy',
    45000,
    0.001,
    'market',
  );

  await testGroup.runKeeper();
  await liqeeAccount.reload(testGroup.connection);
  await liqorAccount.reload(testGroup.connection);

  console.log(
    'Liqor base',
    liqorAccount.perpAccounts[1].basePosition.toString(),
  );
  console.log(
    'Liqor quote',
    liqorAccount.perpAccounts[1].quotePosition.toString(),
  );
  console.log(
    'Liqee base',
    liqeeAccount.perpAccounts[1].basePosition.toString(),
  );
  console.log(
    'Liqee quote',
    liqeeAccount.perpAccounts[1].quotePosition.toString(),
  );

  await testGroup.setOracle(1, 15000);

  await testGroup.runKeeper();
  cache = await mangoGroup.loadCache(connection);
  await liqeeAccount.reload(testGroup.connection);
  await liqorAccount.reload(testGroup.connection);

  console.log(
    'Liqee Maint Health',
    liqeeAccount.getHealthRatio(mangoGroup, cache, 'Maint').toString(),
  );
  console.log(
    'Liqor Maint Health',
    liqorAccount.getHealthRatio(mangoGroup, cache, 'Maint').toString(),
  );

  console.log('liquidatePerpMarket');
  await testGroup.client.liquidatePerpMarket(
    mangoGroup,
    liqeeAccount,
    liqorAccount,
    perpMarkets[0],
    payer,
    liqeeAccount.perpAccounts[1].basePosition,
  );
  await testGroup.runKeeper();
  await liqeeAccount.reload(testGroup.connection);
  await liqorAccount.reload(testGroup.connection);

  console.log(
    'Liqee Maint Health',
    liqeeAccount.getHealthRatio(mangoGroup, cache, 'Maint').toString(),
  );
  console.log('Liqee Bankrupt', liqeeAccount.isBankrupt);
  console.log(
    'Liqor Maint Health',
    liqorAccount.getHealthRatio(mangoGroup, cache, 'Maint').toString(),
  );

  console.log('liquidateTokenAndPerp');
  await testGroup.client.liquidateTokenAndPerp(
    mangoGroup,
    liqeeAccount,
    liqorAccount,
    quoteRootBank,
    payer,
    AssetType.Token,
    QUOTE_INDEX,
    AssetType.Perp,
    1,
    liqeeAccount.perpAccounts[1].quotePosition.abs(),
  );
  await testGroup.runKeeper();
  await liqeeAccount.reload(testGroup.connection);
  await liqorAccount.reload(testGroup.connection);

  console.log(
    'Liqee Maint Health',
    liqeeAccount.getHealthRatio(mangoGroup, cache, 'Maint').toString(),
  );
  console.log('Liqee Bankrupt', liqeeAccount.isBankrupt);
  console.log(
    'Liqor Maint Health',
    liqorAccount.getHealthRatio(mangoGroup, cache, 'Maint').toString(),
  );
  if (liqeeAccount.isBankrupt) {
    console.log('resolvePerpBankruptcy');
    await testGroup.client.resolvePerpBankruptcy(
      mangoGroup,
      liqeeAccount,
      liqorAccount,
      perpMarkets[0],
      quoteRootBank,
      payer,
      1,
      I80F48.fromNumber(
        Math.max(Math.abs(liqeeAccount.perpAccounts[1].quotePosition.toNumber()), 1),
      ),
    );
  }
  await liqeeAccount.reload(testGroup.connection);
  await liqorAccount.reload(testGroup.connection);

  console.log(
    'Liqee Maint Health',
    liqeeAccount.getHealthRatio(mangoGroup, cache, 'Maint').toString(),
  );
  console.log('Liqee Bankrupt', liqeeAccount.isBankrupt);
  console.log(
    'Liqor Maint Health',
    liqorAccount.getHealthRatio(mangoGroup, cache, 'Maint').toString(),
  );
}

testPerpLiquidationAndBankruptcy();
