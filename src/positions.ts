import { Commitment, Connection } from '@solana/web3.js';
import { MangoClient } from './client';
import { Cluster, Config } from './config';

const config = Config.ids();
const cluster = (process.env.CLUSTER || 'mainnet') as Cluster;
const connection = new Connection(
  config.cluster_urls[cluster],
  'processed' as Commitment,
);

const groupName = process.env.GROUP || 'mainnet.1';
const groupIds = config.getGroup(cluster, groupName);
if (!groupIds) {
  throw new Error(`Group ${groupName} not found`);
}

const mangoProgramId = groupIds.mangoProgramId;
const mangoGroupKey = groupIds.publicKey;
const client = new MangoClient(connection, mangoProgramId);

async function main() {
  console.log('getMangoGroup');
  const mangoGroup = await client.getMangoGroup(mangoGroupKey);
  console.log('getAllMangoAccounts');
  const mangoAccounts = await client.getAllMangoAccounts(mangoGroup);
  console.log('loadCache');
  const cache = await mangoGroup.loadCache(connection);

  mangoAccounts.sort((a, b) => {
    const aLiabs = a.getLiabsVal(mangoGroup, cache, 'Maint');
    const bLiabs = b.getLiabsVal(mangoGroup, cache, 'Maint');
    return bLiabs.sub(aLiabs).toNumber();
  });

  for (let i = 0; i < Math.min(30, mangoAccounts.length); i++) {
    console.log(i);
    console.log(mangoAccounts[i].toPrettyString(groupIds!, mangoGroup, cache));
  }
}

main();
