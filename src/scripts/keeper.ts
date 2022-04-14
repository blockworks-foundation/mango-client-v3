/**
This will probably move to its own repo at some point but easier to keep it here for now
 */
import * as os from 'os';
import * as fs from 'fs';
import { MangoClient } from '../client';
import {
  Keypair,
  Commitment,
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { getMultipleAccounts, zeroKey } from '../utils/utils';
import configFile from '../ids.json';
import { Cluster, Config } from '../config';
import {
  makeCachePerpMarketsInstruction,
  makeCachePricesInstruction,
  makeCacheRootBankInstruction,
  makeUpdateFundingInstruction,
  makeUpdateRootBankInstruction,
} from '../instruction';
import BN from 'bn.js';
import { PerpEventQueueLayout } from '../layout';
import { MangoGroup, PerpMarket, promiseUndef } from '..';
import PerpEventQueue from '../PerpEventQueue';

let lastRootBankCacheUpdate = 0;
const groupName = process.env.GROUP || 'mainnet.1';
const updateCacheInterval = parseInt(
  process.env.UPDATE_CACHE_INTERVAL || '3000',
);
const updateRootBankCacheInterval = parseInt(
  process.env.UPDATE_ROOT_BANK_CACHE_INTERVAL || '5000',
);
const processKeeperInterval = parseInt(
  process.env.PROCESS_KEEPER_INTERVAL || '10000',
);
const consumeEventsInterval = parseInt(
  process.env.CONSUME_EVENTS_INTERVAL || '1000',
);
const maxUniqueAccounts = parseInt(process.env.MAX_UNIQUE_ACCOUNTS || '10');
const consumeEventsLimit = new BN(process.env.CONSUME_EVENTS_LIMIT || '10');
const consumeEvents = process.env.CONSUME_EVENTS
  ? process.env.CONSUME_EVENTS === 'true'
  : true;
const cluster = (process.env.CLUSTER || 'mainnet') as Cluster;
const config = new Config(configFile);
const groupIds = config.getGroup(cluster, groupName);

if (!groupIds) {
  throw new Error(`Group ${groupName} not found`);
}
const mangoProgramId = groupIds.mangoProgramId;
const mangoGroupKey = groupIds.publicKey;
const payer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      process.env.KEYPAIR ||
        fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
    ),
  ),
);
const connection = new Connection(
  process.env.ENDPOINT_URL || config.cluster_urls[cluster],
  'processed' as Commitment,
);
const client = new MangoClient(connection, mangoProgramId, { timeout: 10000 });

async function main() {
  if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
  }
  const mangoGroup = await client.getMangoGroup(mangoGroupKey);
  const perpMarkets = await Promise.all(
    groupIds.perpMarkets.map((m) => {
      return mangoGroup.loadPerpMarket(
        connection,
        m.marketIndex,
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
console.time('processUpdateCache');

async function processUpdateCache(mangoGroup: MangoGroup) {
  console.timeEnd('processUpdateCache');

  try {
    const batchSize = 8;
    const promises: Promise<string>[] = [];
    const rootBanks = mangoGroup.tokens
      .map((t) => t.rootBank)
      .filter((t) => !t.equals(zeroKey));
    const oracles = mangoGroup.oracles.filter((o) => !o.equals(zeroKey));
    const perpMarkets = mangoGroup.perpMarkets
      .filter((pm) => !pm.isEmpty())
      .map((pm) => pm.perpMarket);
    const nowTs = Date.now();
    let shouldUpdateRootBankCache = false;
    if (nowTs - lastRootBankCacheUpdate > updateRootBankCacheInterval) {
      shouldUpdateRootBankCache = true;
      lastRootBankCacheUpdate = nowTs;
    }
    for (let i = 0; i < rootBanks.length / batchSize; i++) {
      const startIndex = i * batchSize;
      const endIndex = i * batchSize + batchSize;
      const cacheTransaction = new Transaction();
      if (shouldUpdateRootBankCache) {
        cacheTransaction.add(
          makeCacheRootBankInstruction(
            mangoProgramId,
            mangoGroup.publicKey,
            mangoGroup.mangoCache,
            rootBanks.slice(startIndex, endIndex),
          ),
        );
      }
      cacheTransaction.add(
        makeCachePricesInstruction(
          mangoProgramId,
          mangoGroup.publicKey,
          mangoGroup.mangoCache,
          oracles.slice(startIndex, endIndex),
        ),
      );

      cacheTransaction.add(
        makeCachePerpMarketsInstruction(
          mangoProgramId,
          mangoGroup.publicKey,
          mangoGroup.mangoCache,
          perpMarkets.slice(startIndex, endIndex),
        ),
      );
      if (cacheTransaction.instructions.length > 0) {
        promises.push(client.sendTransaction(cacheTransaction, payer, []));
      }
    }

    Promise.all(promises).catch((err) => {
      console.error('Error updating cache', err);
    });
  } catch (err) {
    console.error('Error in processUpdateCache', err);
  } finally {
    console.time('processUpdateCache');
    setTimeout(processUpdateCache, updateCacheInterval, mangoGroup);
  }
}

async function processConsumeEvents(
  mangoGroup: MangoGroup,
  perpMarkets: PerpMarket[],
) {
  try {
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

    const promises: Promise<string | void>[] = perpMktAndEventQueue.map(
      ({ perpMarket, eventQueue }) => {
        const events = eventQueue.getUnconsumedEvents();
        if (events.length === 0) {
          // console.log('No events to consume');
          return promiseUndef();
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

        return client
          .consumeEvents(
            mangoGroup,
            perpMarket,
            Array.from(accounts)
              .map((s) => new PublicKey(s))
              .sort(),
            payer,
            consumeEventsLimit,
          )
          .then(() => {
            console.log(
              `Consumed up to ${
                events.length
              } events ${perpMarket.publicKey.toBase58()}`,
            );
            console.log(
              'EVENTS:',
              events.map((e) => e?.fill?.seqNum.toString()),
            );
          })
          .catch((err) => {
            console.error('Error consuming events', err);
          });
      },
    );

    Promise.all(promises).catch((err) => {
      console.error('Error consuming events', err);
    });
  } catch (err) {
    console.error('Error in processConsumeEvents', err);
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

    const filteredPerpMarkets = perpMarkets.filter(
      (pm) => !pm.publicKey.equals(zeroKey),
    );

    for (let i = 0; i < groupIds.tokens.length / batchSize; i++) {
      const startIndex = i * batchSize;
      const endIndex = i * batchSize + batchSize;

      const updateRootBankTransaction = new Transaction();
      groupIds.tokens.slice(startIndex, endIndex).forEach((token) => {
        updateRootBankTransaction.add(
          makeUpdateRootBankInstruction(
            mangoProgramId,
            mangoGroup.publicKey,
            mangoGroup.mangoCache,
            token.rootKey,
            token.nodeKeys,
          ),
        );
      });

      const updateFundingTransaction = new Transaction();
      filteredPerpMarkets.slice(startIndex, endIndex).forEach((market) => {
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

    Promise.all(promises).catch((err) => {
      console.error('Error processing keeper instructions', err);
    });
  } catch (err) {
    console.error('Error in processKeeperTransactions', err);
  } finally {
    setTimeout(
      processKeeperTransactions,
      processKeeperInterval,
      mangoGroup,
      perpMarkets,
    );
  }
}

process.on('unhandledRejection', (err: any, p: any) => {
  console.error(`Unhandled rejection: ${err} promise: ${p})`);
});

main();
