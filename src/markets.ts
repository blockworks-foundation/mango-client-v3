import { Commitment, Connection, PublicKey } from '@solana/web3.js';
import { group } from 'console';
import { PerpMarket, PerpMarketConfig } from '.';
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

async function dumpPerpMarket(config: PerpMarketConfig) {
  const group = await client.getMangoGroup(mangoGroupKey);
  const market = await client.getPerpMarket(
    config.publicKey,
    config.baseDecimals,
    config.quoteDecimals,
  );

  console.log(market.toPrettyString(group, config), '\n');
}

groupIds.perpMarkets.forEach((m) => dumpPerpMarket(m));
