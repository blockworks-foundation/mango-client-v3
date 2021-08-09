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
} from '../src';
import configFile from '../src/ids.json';
import { Account, Commitment, Connection } from '@solana/web3.js';
import { Market } from '@project-serum/serum';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';

async function testMaxCompute() {
  // Load all the details for mango group
  const groupName = process.env.GROUP || 'mango_test_v3.nightly';
  const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
  const sleepTime = 500;
  const config = new Config(configFile);
  const groupIds = config.getGroup(cluster, groupName);
  const setupLiqor = true;
  const setupLiqee = true;
  const liqorSpotOrders = MAX_NUM_IN_MARGIN_BASKET;
  const liqeeSpotOrders = MAX_NUM_IN_MARGIN_BASKET;
  const liqorPerpOrders = MAX_PAIRS;
  const liqeePerpOrders = MAX_PAIRS;

  if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
  }
  const mangoProgramId = groupIds.mangoProgramId;
  const mangoGroupKey = groupIds.publicKey;
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

  const client = new MangoClient(connection, mangoProgramId);
  const mangoGroup = await client.getMangoGroup(mangoGroupKey);
  const rootBanks = await mangoGroup.loadRootBanks(connection);
  const quoteRootBank = rootBanks[QUOTE_INDEX];
  if (!quoteRootBank) {
    throw new Error();
  }
  const quoteNodeBanks = await quoteRootBank.loadNodeBanks(connection);

  // Deposit some usdc to borrow
  if (setupLiqor) {
    const whale = await client.initMangoAccount(mangoGroup, payer);
    console.log('Created Liqor:', whale.toBase58());
    await sleep(sleepTime);
    const whaleAccount = await client.getMangoAccount(
      whale,
      mangoGroup.dexProgramId,
    );
    const tokenConfig = groupIds.tokens[QUOTE_INDEX];
    const tokenInfo = mangoGroup.tokens[QUOTE_INDEX];
    const token = new Token(
      connection,
      tokenInfo.mint,
      TOKEN_PROGRAM_ID,
      payer,
    );
    const wallet = await token.getOrCreateAssociatedAccountInfo(
      payer.publicKey,
    );

    for (let i = 0; i < groupIds.tokens.length; i++) {
      if (groupIds.tokens[i].symbol === 'SOL') {
        continue;
      }
      const tokenConfig = groupIds.tokens[i];
      const tokenIndex = mangoGroup.getTokenIndex(tokenConfig.mintKey);
      const rootBank = throwUndefined(rootBanks[tokenIndex]);
      const tokenInfo = mangoGroup.tokens[tokenIndex];
      const token = new Token(
        connection,
        tokenInfo.mint,
        TOKEN_PROGRAM_ID,
        payer,
      );
      const wallet = await token.getOrCreateAssociatedAccountInfo(
        payer.publicKey,
      );

      await sleep(sleepTime / 2);
      const banks = await rootBank.loadNodeBanks(connection);

      await sleep(sleepTime);
      console.log('depositing');

      if (i != QUOTE_INDEX) {
        await client.deposit(
          mangoGroup,
          whaleAccount,
          payer,
          rootBank.publicKey,
          banks[0].publicKey,
          banks[0].vault,
          wallet.address,
          1000,
        );
      }
    }
    await client.deposit(
      mangoGroup,
      whaleAccount,
      payer,
      quoteRootBank.publicKey,
      quoteNodeBanks[0].publicKey,
      quoteNodeBanks[0].vault,
      wallet.address,
      1_000_000,
    );

    // place orders on spot markets
    for (let i = 0; i < liqorSpotOrders; i++) {
      const market = await Market.load(
        connection,
        mangoGroup.spotMarkets[i].spotMarket,
        {},
        mangoGroup.dexProgramId,
      );
      await sleep(sleepTime);
      console.log('placing spot order', i);
      while (1) {
        try {
          await client.placeSpotOrder(
            mangoGroup,
            whaleAccount,
            mangoGroup.mangoCache,
            market,
            payer,
            'buy',
            10000,
            1,
            'limit',
          );
          await sleep(sleepTime);
          await whaleAccount.reload(connection);
          break;
        } catch (e) {
          console.log(e);
          continue;
        }
      }
    }
    // place orders in perp markets
    for (let i = 0; i < liqorPerpOrders; i++) {
      await sleep(sleepTime);
      const perpMarket = await client.getPerpMarket(
        mangoGroup.perpMarkets[i].perpMarket,
        groupIds.perpMarkets[i].baseDecimals,
        groupIds.perpMarkets[i].quoteDecimals,
      );

      console.log('liqor placing perp order', i);
      await sleep(sleepTime);
      await client.placePerpOrder(
        mangoGroup,
        whaleAccount,
        mangoGroup.mangoCache,
        perpMarket,
        payer,
        'buy',
        10000,
        1,
        'limit',
      );
    }
    await whaleAccount.reload(connection);
    console.log('LIQOR', whaleAccount.publicKey.toBase58());
  }
  if (setupLiqee) {
    const mangoAccountPk = await client.initMangoAccount(mangoGroup, payer);
    await sleep(sleepTime);
    let mangoAccount = await client.getMangoAccount(
      mangoAccountPk,
      mangoGroup.dexProgramId,
    );
    console.log('Created Liqee:', mangoAccountPk.toBase58());

    const cache = await mangoGroup.loadCache(connection);
    // deposit
    await sleep(sleepTime / 2);

    for (let i = 0; i < groupIds.tokens.length; i++) {
      if (groupIds.tokens[i].symbol === 'SOL') {
        continue;
      }
      const tokenConfig = groupIds.tokens[i];
      const tokenIndex = mangoGroup.getTokenIndex(tokenConfig.mintKey);
      const rootBank = throwUndefined(rootBanks[tokenIndex]);
      const tokenInfo = mangoGroup.tokens[tokenIndex];
      const token = new Token(
        connection,
        tokenInfo.mint,
        TOKEN_PROGRAM_ID,
        payer,
      );
      const wallet = await token.getOrCreateAssociatedAccountInfo(
        payer.publicKey,
      );

      await sleep(sleepTime / 2);
      const banks = await rootBank.loadNodeBanks(connection);

      await sleep(sleepTime);
      console.log('depositing');

      if (i != QUOTE_INDEX) {
        await client.deposit(
          mangoGroup,
          mangoAccount,
          payer,
          rootBank.publicKey,
          banks[0].publicKey,
          banks[0].vault,
          wallet.address,
          1000,
        );
        console.log('Resetting oracle');
        await client.setStubOracle(
          mangoGroupKey,
          mangoGroup.oracles[i],
          payer,
          10000,
        );
      }
    }

    // place orders on spot markets
    for (let i = 0; i < liqeeSpotOrders; i++) {
      const market = await Market.load(
        connection,
        mangoGroup.spotMarkets[i].spotMarket,
        {},
        mangoGroup.dexProgramId,
      );
      while (1) {
        await sleep(sleepTime);
        console.log('liqee placing spot order', i);
        try {
          await client.placeSpotOrder(
            mangoGroup,
            mangoAccount,
            mangoGroup.mangoCache,
            market,
            payer,
            'buy',
            10000,
            1,
            'limit',
          );
          await sleep(sleepTime);
          mangoAccount = await client.getMangoAccount(
            mangoAccountPk,
            mangoGroup.dexProgramId,
          );
          break;
        } catch (e) {
          console.log(e);
          continue;
        }
      }
    }
    // place orders on perp markets
    for (let i = 0; i < liqeePerpOrders; i++) {
      await sleep(sleepTime);
      const perpMarket = await client.getPerpMarket(
        mangoGroup.perpMarkets[i].perpMarket,
        groupIds.perpMarkets[i].baseDecimals,
        groupIds.perpMarkets[i].quoteDecimals,
      );

      console.log('liqee placing perp order', i);
      await sleep(sleepTime);
      await client.placePerpOrder(
        mangoGroup,
        mangoAccount,
        mangoGroup.mangoCache,
        perpMarket,
        payer,
        'buy',
        10000,
        1,
        'limit',
      );
    }
    console.log('withdrawing');
    await client.withdraw(
      mangoGroup,
      mangoAccount,
      payer,
      quoteRootBank.publicKey,
      quoteRootBank.nodeBanks[0],
      quoteNodeBanks[0].vault,
      750000,
      true,
    );

    await mangoAccount.reload(connection);
    console.log(mangoAccount.getHealth(mangoGroup, cache, 'Maint').toString());
    console.log('LIQEE', mangoAccount.publicKey.toBase58());
  }

  for (let i = 0; i < groupIds.tokens.length; i++) {
    if (i != QUOTE_INDEX) {
      console.log('Setting oracle');
      await client.setStubOracle(
        mangoGroupKey,
        mangoGroup.oracles[i],
        payer,
        20,
      );
    }
  }
}

testMaxCompute();
