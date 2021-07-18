import fs from 'fs';
import os from 'os';
import { Cluster, Config, MangoClient, throwUndefined } from '../src';
import configFile from '../src/ids.json';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { QUOTE_INDEX } from '../src/MangoGroup';
import { Market } from '@project-serum/serum';

async function testMaxCompute() {
  // Load all the details for mango group
  const groupName = process.env.GROUP || 'mango_test_v3.8';
  const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
  const config = new Config(configFile);
  const groupIds = config.getGroup(cluster, groupName);

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

  // create a new mango account
  // TODO make this getOrInitMangoAccount
  // const mangoAccountPk = await client.initMangoAccount(mangoGroup, payer);
  // console.log('Created MangoAccountPk:', mangoAccountPk.toBase58());
  const mangoAccountPk = new PublicKey(
    '5NUXmeSPejeDh1eUPnJHUorrQcpbRidDnSjj5GyodFGF',
  );

  let mangoAccount = await client.getMangoAccount(
    mangoAccountPk,
    mangoGroup.dexProgramId,
  );

  // deposit USDC
  const quoteTokenInfo = mangoGroup.getQuoteTokenInfo();
  const quoteToken = new Token(
    connection,
    quoteTokenInfo.mint,
    TOKEN_PROGRAM_ID,
    payer,
  );
  const quoteWallet = await quoteToken.getOrCreateAssociatedAccountInfo(
    payer.publicKey,
  );

  const rootBanks = await mangoGroup.loadRootBanks(connection);

  const quoteRoot = throwUndefined(rootBanks[QUOTE_INDEX]);
  const quoteBanks = await quoteRoot.loadNodeBanks(connection);

  console.log('depositing');
  await client.deposit(
    mangoGroup,
    mangoAccount,
    payer,
    quoteTokenInfo.rootBank,
    quoteBanks[0].publicKey,
    quoteBanks[0].vault,
    quoteWallet.address,
    1_000_000, // 1 million USDC
  );

  // place an order on 10 different spot markets
  for (let i = 0; i < 10; i++) {
    const market = await Market.load(
      connection,
      mangoGroup.spotMarkets[i].spotMarket,
      {},
      mangoGroup.dexProgramId,
    );
    console.log('placing spot order', i);

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

    mangoAccount = await client.getMangoAccount(
      mangoAccountPk,
      mangoGroup.dexProgramId,
    );
  }

  // place an order in 32 different perp markets
  for (let i = 0; i < groupIds.perpMarkets.length; i++) {
    const perpMarket = await client.getPerpMarket(
      mangoGroup.perpMarkets[i].perpMarket,
      groupIds.perpMarkets[i].baseDecimals,
      groupIds.perpMarkets[i].quoteDecimals,
    );

    console.log('placing perp order', i);
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
}

testMaxCompute();
