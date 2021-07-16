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
    const groupName = process.env.GROUP || 'mango_test_v3.5';
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

      const cacheTransaction1 = new Transaction();
      cacheTransaction1.add(
        makeCacheRootBankInstruction(
          mangoProgramId,
          mangoGroup.publicKey,
          mangoGroup.mangoCache,
          mangoGroup.tokens.map((t) => t.rootBank).slice(0, 15),
        ),
      );

      const cacheTransaction2 = new Transaction();
      cacheTransaction2.add(
        makeCacheRootBankInstruction(
          mangoProgramId,
          mangoGroup.publicKey,
          mangoGroup.mangoCache,
          mangoGroup.tokens.map((t) => t.rootBank).slice(15),
        ),
      );

      const cacheTransaction3 = new Transaction();
      cacheTransaction3.add(
        makeCachePricesInstruction(
          mangoProgramId,
          mangoGroup.publicKey,
          mangoGroup.mangoCache,
          mangoGroup.oracles.slice(0, 15),
        ),
      );

      const cacheTransaction4 = new Transaction();
      cacheTransaction4.add(
        makeCachePricesInstruction(
          mangoProgramId,
          mangoGroup.publicKey,
          mangoGroup.mangoCache,
          mangoGroup.oracles.slice(15),
        ),
      );

      const cacheTransaction5 = new Transaction();
      cacheTransaction5.add(
        makeCachePerpMarketsInstruction(
          mangoProgramId,
          mangoGroup.publicKey,
          mangoGroup.mangoCache,
          mangoGroup.perpMarkets
            .filter((pm) => !pm.isEmpty())
            .slice(0, 15)
            .map((pm) => pm.perpMarket),
        ),
      );

      const cacheTransaction6 = new Transaction();
      cacheTransaction6.add(
        makeCachePerpMarketsInstruction(
          mangoProgramId,
          mangoGroup.publicKey,
          mangoGroup.mangoCache,
          mangoGroup.perpMarkets
            .filter((pm) => !pm.isEmpty())
            .slice(15)
            .map((pm) => pm.perpMarket),
        ),
      );

      const updateRootBankTransaction1 = new Transaction();
      groupIds.tokens.slice(0, 10).forEach((token) => {
        updateRootBankTransaction1.add(
          makeUpdateRootBankInstruction(
            mangoProgramId,
            mangoGroup.publicKey,
            token.rootKey,
            token.nodeKeys,
          ),
        );
      });

      const updateRootBankTransaction2 = new Transaction();
      groupIds.tokens.slice(10, 20).forEach((token) => {
        updateRootBankTransaction2.add(
          makeUpdateRootBankInstruction(
            mangoProgramId,
            mangoGroup.publicKey,
            token.rootKey,
            token.nodeKeys,
          ),
        );
      });

      const updateRootBankTransaction3 = new Transaction();
      groupIds.tokens.slice(20).forEach((token) => {
        updateRootBankTransaction3.add(
          makeUpdateRootBankInstruction(
            mangoProgramId,
            mangoGroup.publicKey,
            token.rootKey,
            token.nodeKeys,
          ),
        );
      });

      const updateFundingTransaction1 = new Transaction();
      perpMarkets.slice(0, 8).forEach((market) => {
        if (market) {
          updateFundingTransaction1.add(
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

      const updateFundingTransaction2 = new Transaction();
      perpMarkets.slice(8, 16).forEach((market) => {
        if (market) {
          updateFundingTransaction2.add(
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

      const updateFundingTransaction3 = new Transaction();
      perpMarkets.slice(16, 24).forEach((market) => {
        if (market) {
          updateFundingTransaction3.add(
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

      const updateFundingTransaction4 = new Transaction();
      perpMarkets.slice(24).forEach((market) => {
        if (market) {
          updateFundingTransaction4.add(
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

      const x = await Promise.all([
        client.sendTransaction(cacheTransaction1, payer, []),
        client.sendTransaction(cacheTransaction2, payer, []),
        client.sendTransaction(cacheTransaction3, payer, []),
        client.sendTransaction(cacheTransaction4, payer, []),
        client.sendTransaction(cacheTransaction5, payer, []),
        client.sendTransaction(cacheTransaction6, payer, []),
        client.sendTransaction(updateRootBankTransaction1, payer, []),
        client.sendTransaction(updateRootBankTransaction2, payer, []),
        client.sendTransaction(updateRootBankTransaction3, payer, []),
        client.sendTransaction(updateFundingTransaction1, payer, []),
        client.sendTransaction(updateFundingTransaction2, payer, []),
        client.sendTransaction(updateFundingTransaction3, payer, []),
        client.sendTransaction(updateFundingTransaction4, payer, []),
      ]);
    }
  }
}

new Keeper().run();
