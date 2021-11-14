import { MangoClient } from './client';
import {
  Commitment,
  Connection
} from '@solana/web3.js';
import { sleep } from './utils';
import configFile from './ids.json';
import {
  Cluster,
  Config,
  getPerpMarketByBaseSymbol,
  PerpMarketConfig
} from './config';

export class Fetcher {
  /**
   * Long running program that never exits except on keyboard interrupt
   */
  async run() {
    const interval = process.env.INTERVAL || 5000;
    const config = new Config(configFile);

    // defaults to mainnet since there's more going on there
    const cluster = (process.env.CLUSTER || 'mainnet') as Cluster;
    const groupName = process.env.GROUP || 'mainnet.1';
    const groupIds = config.getGroup(cluster, groupName);

    if (!groupIds) {
      throw new Error(`Group ${groupName} not found`);
    }

    const mangoProgramId = groupIds.mangoProgramId;
    const mangoGroupKey = groupIds.publicKey;

    // we don't need to load a solana Account; we're not gonna be signing anything

    const connection = new Connection(
      process.env.ENDPOINT_URL || config.cluster_urls[cluster],
      'processed' as Commitment,
    );
    const client = new MangoClient(connection, mangoProgramId);
    const mangoGroup = await client.getMangoGroup(mangoGroupKey);

    const marketName = process.env.MARKET || 'MNGO';

    const perpMarketConfig = getPerpMarketByBaseSymbol(
      groupIds,
      marketName.toUpperCase(),
    ) as PerpMarketConfig;

    if (!perpMarketConfig) {
      throw new Error(`Couldn't find market: ${marketName.toUpperCase()}`);
    }

    const marketIndex = perpMarketConfig.marketIndex;
    const mk = groupIds.perpMarkets[marketIndex];

    const perpMarket = await mangoGroup.loadPerpMarket(
      connection,
      mk.marketIndex,
      mk.baseDecimals,
      mk.quoteDecimals,
    );

    // eslint-disable-next-line
    while (true) {
      await sleep(interval);
      const queue = await perpMarket.loadEventQueue(connection);
      console.log(queue.getUnconsumedEvents());
    }
  }
}

new Fetcher().run();
