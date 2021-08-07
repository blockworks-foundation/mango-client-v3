import * as os from 'os';
import * as fs from 'fs';
import { MangoClient } from './client';
import { Account, Commitment, Connection } from '@solana/web3.js';
import { sleep, ZERO_BN } from './utils';
import configFile from './ids.json';
import { Cluster, Config } from './config';
import BN from 'bn.js';

export class Fetcher {
  /**
   * Long running program that never exits except on keyboard interrupt
   */
  async run() {
    const interval = process.env.INTERVAL || 5000;
    const config = new Config(configFile);

    const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
    const groupName = process.env.GROUP || 'mango_test_v2.2';
    const groupIds = config.getGroup(cluster, groupName);

    if (!groupIds) {
      throw new Error(`Group ${groupName} not found`);
    }

    const mangoProgramId = groupIds.mangoProgramId;
    const mangoGroupKey = groupIds.publicKey;
    const payer = new Account(
      JSON.parse(
        process.env.KEYPAIR ||
          fs.readFileSync(
            os.homedir() + '/.config/solana/devnet.json',
            'utf-8',
          ),
      ),
    );
    const connection = new Connection(
      config.cluster_urls[cluster],
      'processed' as Commitment,
    );
    const client = new MangoClient(connection, mangoProgramId);
    const mangoGroup = await client.getMangoGroup(mangoGroupKey);
    const mk = groupIds.perpMarkets[0];
    const perpMarket = await mangoGroup.loadPerpMarket(
      connection,
      mk.marketIndex,
      mk.baseDecimals,
      mk.quoteDecimals,
    );

    let lastSeqNum = ZERO_BN;
    // eslint-disable-next-line
    while (true) {
      await sleep(interval);
      const queue = await perpMarket.loadEventQueue(connection);
      console.log(queue.eventsSince(lastSeqNum));
      lastSeqNum = queue.seqNum;
    }
  }
}

new Fetcher().run();
