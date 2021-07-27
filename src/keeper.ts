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
import { getMultipleAccounts, zeroKey } from './utils';
import configFile from './ids.json';
import { Cluster, Config } from './config';
import {
  makeCachePerpMarketsInstruction,
  makeCachePricesInstruction,
  makeCacheRootBankInstruction,
  makeUpdateFundingInstruction,
  makeUpdateRootBankInstruction,
} from './instruction';
import BN from 'bn.js';
import { PerpEventQueue, PerpEventQueueLayout } from './layout';
import { MangoGroup, PerpMarket } from '.';

const groupName = process.env.GROUP || 'mango_test_v3.nightly';
const updateCacheInterval = parseInt(
  process.env.UPDATE_CACHE_INTERVAL || '1000',
);
const processKeeperInterval = parseInt(
  process.env.PROCESS_KEEPER_INTERVAL || '15000',
);
const consumeEventsInterval = parseInt(
  process.env.CONSUME_EVENTS_INTERVAL || '4000',
);
const maxUniqueAccounts = parseInt(process.env.MAX_UNIQUE_ACCOUNTS || '20');
const consumeEventsLimit = new BN(process.env.CONSUME_EVENTS_LIMIT || '10');
const consumeEvents = process.env.CONSUME_EVENTS === 'true';
const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
const config = new Config(configFile);
const groupIds = config.getGroup(cluster, groupName);

if (!groupIds) {
  throw new Error(`Group ${groupName} not found`);
}
const mangoProgramId = groupIds.mangoProgramId;
const mangoGroupKey = groupIds.publicKey;
const payer = new Account(
  JSON.parse(
    process.env.KEYPAIR ||
      fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
  ),
);
const connection = new Connection(
  config.cluster_urls[cluster],
  'processed' as Commitment,
);
const client = new MangoClient(connection, mangoProgramId);

async function main() {
  if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
  }
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

  processUpdateCache(mangoGroup);
  processKeeperTransactions(mangoGroup, perpMarkets);

  if (consumeEvents) {
    processConsumeEvents(mangoGroup, perpMarkets);
  }
}

async function processUpdateCache(mangoGroup: MangoGroup) {
  try {
    console.log('processUpdateCache');
    const batchSize = 8;
    const promises: Promise<string>[] = [];

    for (let i = 0; i < mangoGroup.tokens.length / batchSize; i++) {
      const startIndex = i * batchSize;
      const endIndex = i * batchSize + batchSize;
      const cacheTransaction = new Transaction();
      cacheTransaction.add(
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

      cacheTransaction.add(
        makeCachePricesInstruction(
          mangoProgramId,
          mangoGroup.publicKey,
          mangoGroup.mangoCache,
          mangoGroup.oracles
            .slice(startIndex, endIndex)
            .filter((x) => !x.equals(zeroKey)),
        ),
      );

      cacheTransaction.add(
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
      if (cacheTransaction.instructions.length > 0) {
        promises.push(client.sendTransaction(cacheTransaction, payer, []));
      }
    }

    await Promise.all(promises);
  } catch (err) {
    console.error('Error updating cache', err);
  } finally {
    setTimeout(processUpdateCache, updateCacheInterval, mangoGroup);
  }
}

async function processConsumeEvents(
  mangoGroup: MangoGroup,
  perpMarkets: PerpMarket[],
) {
  try {
    console.log('processConsumeEvents');

    const eventQueuePks = perpMarkets.map((mkt) => mkt.eventQueue);
    const eventQueueAccts = await getMultipleAccounts(
      connection,
      eventQueuePks,
    );

    const perpMktAndEventQueue = eventQueueAccts.map(
      ({ publicKey, accountInfo }) => {
        const parsed = PerpEventQueueLayout.decode(accountInfo?.data);
        const eventQueue = new PerpEventQueue(parsed);
        const perpMarket = perpMarkets.find((mkt) =>
          mkt.eventQueue.equals(publicKey),
        );
        if (!perpMarket) {
          throw new Error('PerpMarket not found');
        }
        return { perpMarket, eventQueue };
      },
    );

    for (let i = 0; i < perpMktAndEventQueue.length; i++) {
      const { perpMarket, eventQueue } = perpMktAndEventQueue[i];

      const events = eventQueue.getUnconsumedEvents();
      if (events.length === 0) {
        // console.log('No events to consume');
        return;
      }

      const accounts: Set<string> = new Set();
      for (const event of events) {
        if (event.fill) {
          accounts.add(event.fill.maker.toBase58());
          accounts.add(event.fill.taker.toBase58());
        } else if (event.out) {
          accounts.add(event.out.owner.toBase58());
        }

        // Limit unique accounts to first 20 or 21
        if (accounts.size >= maxUniqueAccounts) {
          break;
        }
      }

      await client.consumeEvents(
        mangoGroup,
        perpMarket,
        Array.from(accounts)
          .map((s) => new PublicKey(s))
          .sort(),
        payer,
        consumeEventsLimit,
      );
      console.log(`Consumed up to ${events.length} events`);
    }
  } catch (err) {
    console.error('Error consuming events', err);
  } finally {
    setTimeout(
      processConsumeEvents,
      consumeEventsInterval,
      mangoGroup,
      perpMarkets,
    );
  }
}

async function processKeeperTransactions(
  mangoGroup: MangoGroup,
  perpMarkets: PerpMarket[],
) {
  try {
    if (!groupIds) {
      throw new Error(`Group ${groupName} not found`);
    }
    console.log('processKeeperTransactions');
    const batchSize = 8;
    const promises: Promise<string>[] = [];
    for (let i = 0; i < mangoGroup.tokens.length / batchSize; i++) {
      const startIndex = i * batchSize;
      const endIndex = i * batchSize + batchSize;

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

      if (updateRootBankTransaction.instructions.length > 0) {
        promises.push(
          client.sendTransaction(updateRootBankTransaction, payer, []),
        );
      }
      if (updateFundingTransaction.instructions.length > 0) {
        promises.push(
          client.sendTransaction(updateFundingTransaction, payer, []),
        );
      }
    }

    await Promise.all(promises);
  } catch (err) {
    console.error('Error processing keeper instructions', err);
  } finally {
    setTimeout(
      processKeeperTransactions,
      processKeeperInterval,
      mangoGroup,
      perpMarkets,
    );
  }
}

main();
