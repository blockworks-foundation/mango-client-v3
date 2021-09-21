import fs from 'fs';
import os from 'os';
import {
  Cluster,
  Config,
  MangoClient,
  sleep,
} from '../src';
import configFile from '../src/ids.json';
import { Account, Commitment, Connection } from '@solana/web3.js';

async function testStopLoss() {
  // Load all the details for mango group
  const groupName = process.env.GROUP || 'devnet.2';
  const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
  const sleepTime = 500;
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
  const perpMarkets = await Promise.all(
    groupIds.perpMarkets.map((perpMarket) => {
      return mangoGroup.loadPerpMarket(
        connection,
        perpMarket.marketIndex,
        perpMarket.baseDecimals,
        perpMarket.quoteDecimals,
      );
    }),
  );

  const cache = await mangoGroup.loadCache(connection);

  const accountPk = await client.initMangoAccount(mangoGroup, payer);
  console.log('Created Account:', accountPk.toBase58());
  await sleep(sleepTime);
  const account = await client.getMangoAccount(
    accountPk,
    mangoGroup.dexProgramId,
  );

  await client.addPerpTriggerOrder(
    mangoGroup,
    account,
    perpMarkets[0],
    payer,
    'limit',
    'sell',
    39000,
    0.0001,
    'below',
    39000,
  );
  console.log(await account.loadAdvancedOrders(connection));
}

testStopLoss();
