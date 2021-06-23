/**
This will probably move to its own repo at some point but easier to keep it here for now
This will be a long running program that will call all the Keeper related instructions on-chain

This will be very similar to the crank in serum dex.

 */
import * as os from 'os';
import * as fs from 'fs';
import { MerpsClient } from './client';
import {
  Account,
  Commitment,
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { sleep } from './utils';
import configFile from './ids.json';
import { Cluster, Config } from './config';
import { QUOTE_INDEX } from '../src/MerpsGroup';
import {
  makeCachePerpMarketsInstruction,
  makeCachePricesInstruction,
  makeCacheRootBankInstruction,
  makeUpdateFundingInstruction,
  makeUpdateRootBankInstruction,
} from './instruction';
import BN from 'bn.js';

export class Keeper {
  /**
   * Long running program that never exits except on keyboard interrupt
   */
  async run() {
    const interval = process.env.INTERVAL || 5000;
    const config = new Config(configFile);

    const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
    const groupName = process.env.GROUP || 'merps_test_v2.2';
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
    const perpMarkets = await Promise.all(
      groupIds.perpMarkets.map((m, i) => {
        return merpsGroup.loadPerpMarket(
          connection,
          i,
          m.baseDecimals,
          m.quoteDecimals,
        );
      }),
    );

    let lastSeqNums = {};
    perpMarkets.forEach((m) => {
      lastSeqNums[m.publicKey.toBase58()] = new BN(0);
    });

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

      const updateFundingTransaction = new Transaction();
      perpMarkets.forEach((market) => {
        if (market) {
          updateFundingTransaction.add(
            makeUpdateFundingInstruction(
              merpsProgramId,
              merpsGroup.publicKey,
              merpsGroup.merpsCache,
              market.publicKey,
              market.bids,
              market.asks,
            ),
          );
        }
      });

      if (process.env.CONSUME_EVENTS == 'true') {
        await Promise.all(
          perpMarkets.map((m) => {
            return m.loadEventQueue(connection).then((queue) => {
              const accounts: PublicKey[] = [];
              const events = queue.eventsSince(
                lastSeqNums[m.publicKey.toBase58()],
              );

              events.forEach((ev) => {
                if (ev.fill) {
                  accounts.push(ev.fill.owner);
                }
                if (ev.out) {
                  accounts.push(ev.out.owner);
                }
              });

              client.consumeEvents(
                merpsGroup.publicKey,
                m.publicKey,
                m.eventQueue,
                accounts,
                payer,
                new BN(events.length),
              );
              console.log(`Consumed ${events.length} events`);
              lastSeqNums[m.publicKey.toBase58()] = queue.seqNum;
            });
          }),
        );
      }

      await Promise.all([
        client.sendTransaction(cacheTransaction, payer, []),
        client.sendTransaction(updateRootBankTransaction, payer, []),
        client.sendTransaction(updateFundingTransaction, payer, []),
      ]);
    }
  }
}

new Keeper().run();
