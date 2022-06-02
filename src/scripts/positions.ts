import { Commitment, Connection, PublicKey } from '@solana/web3.js';
import { MangoClient } from '../client';
import {
  Cluster,
  Config,
  getPerpMarketByBaseSymbol,
  getSpotMarketByBaseSymbol,
} from '../config';

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

const dexProgramId = groupIds.serumProgramId;
const mangoProgramId = groupIds.mangoProgramId;
const mangoGroupKey = groupIds.publicKey;
const client = new MangoClient(connection, mangoProgramId);

async function watchAccount(pk: PublicKey) {
  const group = await client.getMangoGroup(mangoGroupKey);
  const account = await client.getMangoAccount(pk, dexProgramId);
  const cache = await group.loadCache(connection);
  console.log(account.toPrettyString(groupIds!, group, cache));
  console.log('Assets:', account.getAssetsVal(group, cache).toString());
  console.log('Liabs:', account.getLiabsVal(group, cache).toString());
}

async function watchHighestLiabilities(n: number) {
  console.log('getMangoGroup');
  const group = await client.getMangoGroup(mangoGroupKey);
  console.log('getAllMangoAccounts');
  const mangoAccounts = await client.getAllMangoAccounts(group);
  console.log('loadCache');
  const cache = await group.loadCache(connection);

  mangoAccounts.sort((a, b) => {
    const aLiabs = a.getLiabsVal(group, cache, 'Maint');
    const bLiabs = b.getLiabsVal(group, cache, 'Maint');
    return bLiabs.sub(aLiabs).toNumber();
  });

  for (let i = 0; i < Math.min(n, mangoAccounts.length); i++) {
    console.log(i);
    console.log(mangoAccounts[i].toPrettyString(groupIds!, group, cache));
  }
}

async function watchHighestOI(mkt: string, n: number) {
  const cfg = getPerpMarketByBaseSymbol(groupIds!, mkt)!;

  console.log('getMangoGroup');
  const group = await client.getMangoGroup(mangoGroupKey);
  console.log('getAllMangoAccounts');
  const mangoAccounts = await client.getAllMangoAccounts(group);
  console.log('loadCache');
  const cache = await group.loadCache(connection);

  mangoAccounts.sort((a, b) => {
    const aOI = a.perpAccounts[cfg.marketIndex].basePosition.abs();
    const bOA = b.perpAccounts[cfg.marketIndex].basePosition.abs();
    return bOA.sub(aOI).toNumber();
  });

  for (let i = 0; i < Math.min(n, mangoAccounts.length); i++) {
    console.log(i);
    console.log(mangoAccounts[i].toPrettyString(groupIds!, group, cache));
  }
}

async function watchHighestSpotBalance(mkt: string, n: number) {
  const cfg = getSpotMarketByBaseSymbol(groupIds!, mkt)!;

  console.log('getMangoGroup');
  const group = await client.getMangoGroup(mangoGroupKey);
  console.log('getAllMangoAccounts');
  const mangoAccounts = await client.getAllMangoAccounts(group);
  console.log('loadCache');
  const cache = await group.loadCache(connection);

  mangoAccounts.sort((a, b) => {
    const aBalance = a.getUiDeposit(
      cache.rootBankCache[cfg.marketIndex],
      group,
      cfg.marketIndex,
    );
    const bBalance = b.getUiDeposit(
      cache.rootBankCache[cfg.marketIndex],
      group,
      cfg.marketIndex,
    );
    return bBalance.sub(aBalance).toNumber();
  });

  for (let i = 0; i < Math.min(n, mangoAccounts.length); i++) {
    console.log(i);
    console.log(mangoAccounts[i].toPrettyString(groupIds!, group, cache));
  }
}

if (process.env.ACC) {
  watchAccount(new PublicKey(process.env.ACC));
} else if (process.env.PERP) {
  watchHighestOI(process.env.PERP, 10);
} else if (process.env.SPOT) {
  watchHighestSpotBalance(process.env.SPOT, 10);
} else {
  watchHighestLiabilities(30);
}
