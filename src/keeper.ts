/**
This will probably move to its own repo at some point but easier to keep it here for now
This will be a long running program that will call all the Keeper related instructions on-chain

This will be very similar to the crank in serum dex.

 */
import * as os from 'os';
import * as fs from 'fs';
import { MerpsClient } from './client';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import { sleep } from './utils';
import configFile from './ids.json';
import { Cluster, Config } from './config';

export class Keeper {
  /**
   * Long running program that never exits except on keyboard interrupt
   */
  async run() {
    const interval = 5000;
    // eslint-disable-next-line
    while (true) {
      await sleep(interval);
      const config = new Config(configFile);

      const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
      const groupName = process.env.GROUP || 'merps_v1';
      const groupIds = config.getGroup(cluster, groupName);

      if (!groupIds) {
        throw new Error(`Group ${groupName} not found`);
      }

      const merpsProgramId = groupIds.merps_program_id;
      const merpsGroupKey = groupIds.key;
      const payer = new Account(
        JSON.parse(
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
      const client = new MerpsClient(connection, merpsProgramId);
      const merpsGroup = await client.getMerpsGroup(merpsGroupKey);
      // TODO: roll these into single transaction?
      await Promise.all([
        client.cacheRootBanks(
          merpsGroup.publicKey,
          merpsGroup.merpsCache,
          [],
          payer,
        ),
        client.cachePrices(
          merpsGroup.publicKey,
          merpsGroup.merpsCache,
          merpsGroup.oracles,
          payer,
        ),
        client.cachePerpMarkets(
          merpsGroup.publicKey,
          merpsGroup.merpsCache,
          merpsGroup.perpMarkets
            .filter((pm) => !pm.isEmpty())
            .map((pm) => pm.perpMarket),
          payer,
        ),
      ]);

      const rootBanks = await merpsGroup.loadRootBanks(connection);
      await Promise.all(
        rootBanks.map((rootBank) => {
          if (rootBank) {
            return client.updateRootBank(
              merpsGroup.publicKey,
              rootBank.publicKey,
              rootBank.nodeBanks.slice(0, rootBank.numNodeBanks),
              payer,
            );
          }
        }),
      );
    }
  }
}

new Keeper().run();
