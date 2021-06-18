/**
This will probably move to its own repo at some point but easier to keep it here for now
This will be a long running program that will call all the Keeper related instructions on-chain

This will be very similar to the crank in serum dex.

 */
import * as os from 'os';
import * as fs from 'fs';
import { MerpsClient } from './client';
import { Account, Commitment, Connection, Transaction } from '@solana/web3.js';
import { sleep } from './utils';
import configFile from './ids.json';
import { Cluster, Config } from './config';
import { QUOTE_INDEX } from '../src/MerpsGroup';
import {
  makeCachePerpMarketsInstruction,
  makeCachePricesInstruction,
  makeCacheRootBankInstruction,
  makeUpdateRootBankInstruction,
} from './instruction';

export class Keeper {
  /**
   * Long running program that never exits except on keyboard interrupt
   */
  async run() {
    const interval = process.env.INTERVAL || 5000;
    const config = new Config(configFile);

    const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
    const groupName = process.env.GROUP || 'merps_test_v2';
    const groupIds = config.getGroup(cluster, groupName);

    if (!groupIds) {
      throw new Error(`Group ${groupName} not found`);
    }

    const merpsProgramId = groupIds.merpsProgramId;
    const merpsGroupKey = groupIds.publicKey;
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
    const client = new MerpsClient(connection, merpsProgramId);
    const merpsGroup = await client.getMerpsGroup(merpsGroupKey);

    // eslint-disable-next-line
    while (true) {
      await sleep(interval);

      const cacheTransaction = new Transaction();
      cacheTransaction.add(
        makeCacheRootBankInstruction(
          merpsProgramId,
          merpsGroup.publicKey,
          merpsGroup.merpsCache,
          [
            merpsGroup.tokens[0].rootBank,
            merpsGroup.tokens[QUOTE_INDEX].rootBank,
          ],
        ),
      );
      cacheTransaction.add(
        makeCachePricesInstruction(
          merpsProgramId,
          merpsGroup.publicKey,
          merpsGroup.merpsCache,
          merpsGroup.oracles,
        ),
      );
      cacheTransaction.add(
        makeCachePerpMarketsInstruction(
          merpsProgramId,
          merpsGroup.publicKey,
          merpsGroup.merpsCache,
          merpsGroup.perpMarkets
            .filter((pm) => !pm.isEmpty())
            .map((pm) => pm.perpMarket),
        ),
      );
      await client.sendTransaction(cacheTransaction, payer, []);

      const updateRootBankTransaction = new Transaction();
      groupIds.tokens.forEach((token) => {
        updateRootBankTransaction.add(
          makeUpdateRootBankInstruction(
            merpsProgramId,
            merpsGroup.publicKey,
            token.rootKey,
            token.nodeKeys,
          ),
        );
      });
      await client.sendTransaction(updateRootBankTransaction, payer, []);

      // const perpMarkets = await merpsGroup.loadPerpMarkets(connection);
      // await Promise.all([
      //   perpMarkets.map((perpMarket) => {
      //     if (perpMarket) {
      //       return client
      //         .updateFunding(
      //           merpsGroup.publicKey,
      //           merpsGroup.merpsCache,
      //           perpMarket.publicKey,
      //           perpMarket.bids,
      //           perpMarket.asks,
      //           payer,
      //         )
      //         .catch((err) => {
      //           console.error('Failed to update funding', err);
      //           return err;
      //         });
      //     }
      //   }),
      // ]);
      // console.log(perpMarkets[0]!.eventQueue.toBase58());
      // const eventQueue = await client.getEventQueue(perpMarkets[0]!.eventQueue);
      // console.log(eventQueue['events'][0]['padding']);

      // TODO: consume events
      //
    }
  }
}

new Keeper().run();
