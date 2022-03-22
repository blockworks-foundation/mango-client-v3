/**
 This will probably move to its own repo at some point but easier to keep it here for now
 */
import * as os from 'os';
import * as fs from 'fs';
import { MangoClient } from '../client';
import { Keypair, Commitment, Connection, PublicKey } from '@solana/web3.js';
import configFile from '../ids.json';
import { Cluster, Config } from '../config';
import { QUOTE_INDEX } from '..';

const config = new Config(configFile);

const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
const groupName = process.env.GROUP || 'devnet.2';
const groupIds = config.getGroup(cluster, groupName);

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
  process.env.ENDPOINT_URL || config.cluster_urls[cluster],
  'processed' as Commitment,
);
const client = new MangoClient(connection, mangoProgramId);

async function run() {
  if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
  }

  const mangoGroup = await client.getMangoGroup(mangoGroupKey);
  const rootBanks = await mangoGroup.loadRootBanks(connection);
  const cache = await mangoGroup.loadCache(connection);
  const quoteRootBank = rootBanks[QUOTE_INDEX];
  if (!quoteRootBank) {
    throw new Error('Quote Rootbank Not Found');
  }
  const mangoAccount = await client.getMangoAccount(
    new PublicKey('8m3Lh1Exh5WaG76aFRWFGgMU5yWXLxifbgVfCnFjv15p'),
    mangoGroup.dexProgramId,
  );
  //    console.log('Creating group dust account');
  //    await client.createDustAccount(mangoGroup, payer);
  console.log('Resolving account dust');
  await client.resolveDust(
    mangoGroup,
    mangoAccount,
    quoteRootBank,
    cache,
    payer,
  );
}

run();
