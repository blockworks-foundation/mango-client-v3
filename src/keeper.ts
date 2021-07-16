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
import { sleep, zeroKey } from './utils';
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
    const interval = process.env.INTERVAL || 2000;
    const maxUniqueAccounts = parseInt(process.env.MAX_UNIQUE_ACCOUNTS || '20');
    const consumeEventsLimit = new BN(process.env.CONSUME_EVENTS_LIMIT || '10');
    const consumeEvents = process.env.CONSUME_EVENTS === 'true';
    const config = new Config(configFile);

    const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
    const groupName = process.env.GROUP || 'mango_test_v3.6';
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

    async function batchProcessKeeperTransactions(startIndex, endIndex) {
      const cacheBankTransaction = new Transaction();
      cacheBankTransaction.add(
        makeCacheRootBankInstruction(
          mangoProgramId,
          mangoGroup.publicKey,
          mangoGroup.mangoCache,
          mangoGroup.tokens
            .map((t) => t.rootBank)
            .slice(startIndex, endIndex)
            .filter((x) => !x.equals(zeroKey)),
        ),
      );

      const cachePriceTransaction = new Transaction();
      cachePriceTransaction.add(
        makeCachePricesInstruction(
          mangoProgramId,
          mangoGroup.publicKey,
          mangoGroup.mangoCache,
          mangoGroup.oracles
            .slice(startIndex, endIndex)
            .filter((x) => !x.equals(zeroKey)),
        ),
      );

      const cachePerpTransaction = new Transaction();
      cachePerpTransaction.add(
        makeCachePerpMarketsInstruction(
          mangoProgramId,
          mangoGroup.publicKey,
          mangoGroup.mangoCache,
          mangoGroup.perpMarkets
            .filter((pm) => !pm.isEmpty())
            .slice(startIndex, endIndex)
            .map((pm) => pm.perpMarket),
        ),
      );

      if (!groupIds) {
        throw new Error(`Group ${groupName} not found`);
      }

      const updateRootBankTransaction = new Transaction();
      groupIds.tokens.slice(startIndex, endIndex).forEach((token) => {
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
      perpMarkets
        .slice(startIndex, endIndex)
        .filter((pm) => !pm.publicKey.equals(zeroKey))
        .forEach((market) => {
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

      await Promise.all([
        client.sendTransaction(cacheBankTransaction, payer, []),
        client.sendTransaction(cachePriceTransaction, payer, []),
        client.sendTransaction(cachePerpTransaction, payer, []),
        client.sendTransaction(updateRootBankTransaction, payer, []),
        client.sendTransaction(updateFundingTransaction, payer, []),
      ]);
    }

    // eslint-disable-next-line
    while (true) {
      await sleep(interval);

      try {
        await batchProcessKeeperTransactions(0, 8);
        await batchProcessKeeperTransactions(8, 16);
        // await batchProcessKeeperTransactions(16, 24);
        // await batchProcessKeeperTransactions(24, 32);
      } catch (err) {
        console.error('Error', `${err}`);
      }

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
    }
  }
}

new Keeper().run();
