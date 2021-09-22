import fs from 'fs';
import os from 'os';
import { Cluster, Config, MangoClient, sleep } from '../src';
import configFile from '../src/ids.json';
import {
  Account,
  Commitment,
  Connection,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';

async function testStopLoss() {
  // Load all the details for mango group
  const groupName = process.env.GROUP || 'devnet.2';
  const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
  const sleepTime = 2000;
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

  // Add the trigger order
  await sleep(sleepTime);
  const txid = await client.addPerpTriggerOrder(
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
  console.log('add perp trigger order successful', txid.toString());
  const advanced = await account.loadAdvancedOrders(connection);
  console.log(advanced.filter((o) => o.perpTrigger && o.perpTrigger.isActive));

  // Agent trigger the order
  // First create an agent SOL account and fund it
  const agent = new Account();
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: agent.publicKey,
      lamports: 0.1 * LAMPORTS_PER_SOL,
    }),
  );
  await sendAndConfirmTransaction(connection, tx, [payer]);
  await sleep(sleepTime);
  const agentAcc = await connection.getAccountInfo(agent.publicKey);
  console.log(
    'agent:',
    agent.publicKey.toBase58(),
    'sol:',
    agentAcc ? agentAcc.lamports / LAMPORTS_PER_SOL : 0,
  );

  // Now trigger the order
  // TODO
}

testStopLoss();
