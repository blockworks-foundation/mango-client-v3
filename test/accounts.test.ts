import fs from 'fs';
import os from 'os';
import { Cluster, Config, MangoClient, sleep } from '../src';
import configFile from '../src/ids.json';
import { Keypair, Commitment, Connection } from '@solana/web3.js';

async function testAccounts() {
  // Load all the details for mango group
  const groupName = process.env.GROUP || 'mango_test_v3.nightly';
  const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
  const sleepTime = 250;
  const config = new Config(configFile);
  const groupIds = config.getGroup(cluster, groupName);
  const accounts = 10000;

  if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
  }
  const mangoProgramId = groupIds.mangoProgramId;
  const mangoGroupKey = groupIds.publicKey;
  const payer = new Keypair(
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

  for (let i = 0; i < accounts; i++) {
    try {
      await client.initMangoAccount(mangoGroup, payer);
      console.log(`Created account ${i}/${accounts}`);
    } catch (err) {
      console.error('Failed to create account');
    } finally {
      await sleep(sleepTime);
    }
  }
}

testAccounts();
