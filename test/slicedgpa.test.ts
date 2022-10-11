import { Commitment, Connection } from '@solana/web3.js';
import { MangoClient } from '../src/client';
import { Cluster, Config } from '../src/config';

const config = Config.ids();
const cluster = (process.env.CLUSTER || 'mainnet') as Cluster;
const connection = new Connection(
  config.cluster_urls[cluster],
  'processed' as Commitment,
);

const groupName = process.env.GROUP || 'mainnet.1';
const groupIds = config.getGroup(cluster, groupName)!;

const mangoProgramId = groupIds.mangoProgramId;
const mangoGroupKey = groupIds.publicKey;
const client = new MangoClient(connection, mangoProgramId);

async function check() {
  const group = await client.getMangoGroup(mangoGroupKey);
  const cache = await group.loadCache(connection);
  const perpMarkets = await Promise.all(
    groupIds.perpMarkets.map((m) => {
      return group.loadPerpMarket(
        connection,
        m.marketIndex,
        m.baseDecimals,
        m.quoteDecimals,
      );
    }),
  );

  console.time('thicc');
  const accountsThicc = await client.fetchTopPnlAccountsFromRPC(group, cache, perpMarkets[0], cache.getPrice(0), 1, undefined, false);
  console.timeEnd('thicc');
  console.time('thinn');
  const accountsThinn = await client.fetchTopPnlAccountsFromRPC(group, cache, perpMarkets[0], cache.getPrice(0), 1, undefined, true);
  console.timeEnd('thinn');
  console.log(accountsThicc.length, accountsThicc[0].publicKey.toBase58(), accountsThicc[0].pnl.toNumber())
  console.log(accountsThinn.length, accountsThinn[0].publicKey.toBase58(), accountsThinn[0].pnl.toNumber())
}

check();
