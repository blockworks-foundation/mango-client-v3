/**
This will probably move to its own repo at some point but easier to keep it here for now
 */
import * as os from 'os';
import * as fs from 'fs';
import { MangoClient } from './client';
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
import { QUOTE_INDEX } from '../src/MangoGroup';
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
    const interval = process.env.INTERVAL || 3500;
    const maxUniqueAccounts = parseInt(process.env.MAX_UNIQUE_ACCOUNTS || '20');
    const consumeEventsLimit = new BN(process.env.CONSUME_EVENTS_LIMIT || '10');
    const consumeEvents = process.env.CONSUME_EVENTS === 'true';
    const config = new Config(configFile);

    const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
    const groupName = process.env.GROUP || 'mango_test_v3.4';
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
    const perpMarkets = await Promise.all(
      groupIds.perpMarkets.map((m, i) => {
        return mangoGroup.loadPerpMarket(
          connection,
          i,
          m.baseDecimals,
          m.quoteDecimals,
        );
      }),
    );

    const lastSeqNums = {};
    perpMarkets.forEach((m) => {
      lastSeqNums[m.publicKey.toBase58()] = new BN(0);
    });

    // eslint-disable-next-line
    while (true) {
      await sleep(interval);

      const cacheTransaction = new Transaction();
      cacheTransaction.add(
        makeCacheRootBankInstruction(
          mangoProgramId,
          mangoGroup.publicKey,
          mangoGroup.mangoCache,
          [
            mangoGroup.tokens[0].rootBank,
            mangoGroup.tokens[QUOTE_INDEX].rootBank,
          ],
        ),
      );
      cacheTransaction.add(
        makeCachePricesInstruction(
          mangoProgramId,
          mangoGroup.publicKey,
          mangoGroup.mangoCache,
          mangoGroup.oracles,
        ),
      );
      cacheTransaction.add(
        makeCachePerpMarketsInstruction(
          mangoProgramId,
          mangoGroup.publicKey,
          mangoGroup.mangoCache,
          mangoGroup.perpMarkets
            .filter((pm) => !pm.isEmpty())
            .map((pm) => pm.perpMarket),
        ),
      );

      const updateRootBankTransaction = new Transaction();
      groupIds.tokens.forEach((token) => {
        updateRootBankTransaction.add(
          makeUpdateRootBankInstruction(
            mangoProgramId,
            mangoGroup.publicKey,
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
              mangoProgramId,
              mangoGroup.publicKey,
              mangoGroup.mangoCache,
              market.publicKey,
              market.bids,
              market.asks,
            ),
          );
        }
      });

      if (consumeEvents) {
        await Promise.all(
          perpMarkets.map((m) => {
            return m.loadEventQueue(connection).then((queue) => {
              const events = queue.getUnconsumedEvents();
              if (events.length === 0) {
                console.log('No events to consume');
                return;
              }

              const accounts: Set<PublicKey> = new Set();
              for (const event of events) {
                if (event.fill) {
                  accounts.add(event.fill.maker);
                  accounts.add(event.fill.taker);
                } else if (event.out) {
                  accounts.add(event.out.owner);
                }

                // Limit unique accounts to first 20 or 21
                if (accounts.size >= maxUniqueAccounts) {
                  break;
                }
              }

              client.consumeEvents(
                mangoGroup,
                m,
                Array.from(accounts),
                payer,
                consumeEventsLimit,
              );
              console.log(`Consumed up to ${events.length} events`);
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
