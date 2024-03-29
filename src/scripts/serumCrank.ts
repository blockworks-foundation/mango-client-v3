/**
 This will probably move to its own repo at some point but easier to keep it here for now
 */
import * as os from 'os';
import * as fs from 'fs';
import markets from '../serum.json';
import {
  Keypair,
  Commitment,
  Connection,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { getMultipleAccounts, sleep } from '../utils/utils';
import BN from 'bn.js';
import {
  decodeEventQueue,
  DexInstructions,
  Market,
} from '@project-serum/serum';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const {
  ENDPOINT_URL,
  KEYPAIR,
  PROGRAM_ID,
  INTERVAL,
  MAX_UNIQUE_ACCOUNTS,
  CONSUME_EVENTS_LIMIT,
  CLUSTER,
  PRIORITY_MARKETS,      // markets to apply a priority fee for
  PRIORITY_QUEUE_LIMIT,  // queue length at which to apply the priority fee
  PRIORITY_CU_PRICE,     // extra microlamports per cu
  PRIORITY_CU_LIMIT,     // compute limit
} = process.env;

const cluster = CLUSTER || 'mainnet';
const interval = INTERVAL || 3500;
const maxUniqueAccounts = parseInt(MAX_UNIQUE_ACCOUNTS || '10');
const consumeEventsLimit = new BN(CONSUME_EVENTS_LIMIT || '10');
const priorityMarkets: number[] = JSON.parse(PRIORITY_MARKETS || "[]");
const priorityQueueLimit = parseInt(PRIORITY_QUEUE_LIMIT || "100");
const priorityCuPrice = parseInt(PRIORITY_CU_PRICE || "5000");
const priorityCuLimit = parseInt(PRIORITY_CU_LIMIT || "200000");
const serumProgramId = new PublicKey(
  PROGRAM_ID || cluster == 'mainnet'
    ? 'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX'
    : 'EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj',
);
const payer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      KEYPAIR ||
        fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
    ),
  ),
);

console.log('serumCrank', payer.publicKey.toString());

const connection = new Connection(ENDPOINT_URL!, 'processed' as Commitment);

async function run() {
  const spotMarkets = await Promise.all(
    markets[cluster].map((m) => {
      return Market.load(
        connection,
        new PublicKey(m.address),
        {
          skipPreflight: true,
          commitment: 'processed' as Commitment,
        },
        serumProgramId,
      );
    }),
  );

  const quoteToken = new Token(
    connection,
    spotMarkets[0].quoteMintAddress,
    TOKEN_PROGRAM_ID,
    payer,
  );
  const quoteWallet = await quoteToken
    .getOrCreateAssociatedAccountInfo(payer.publicKey)
    .then((a) => a.address);

  const baseWallets = await Promise.all(
    spotMarkets.map((m) => {
      const token = new Token(
        connection,
        m.baseMintAddress,
        TOKEN_PROGRAM_ID,
        payer,
      );

      return token
        .getOrCreateAssociatedAccountInfo(payer.publicKey)
        .then((a) => a.address);
    }),
  );

  const eventQueuePks = spotMarkets.map(
    (market) => market['_decoded'].eventQueue,
  );

  // eslint-disable-next-line
  while (true) {
    try {
      const eventQueueAccts = await getMultipleAccounts(
        connection,
        eventQueuePks,
      );

      for (let i = 0; i < eventQueueAccts.length; i++) {
        const accountInfo = eventQueueAccts[i].accountInfo;
        const events = decodeEventQueue(accountInfo.data);

        if (events.length === 0) {
          continue;
        }

        const accounts: Set<string> = new Set();
        for (const event of events) {
          accounts.add(event.openOrders.toBase58());

          // Limit unique accounts to first 10
          if (accounts.size >= maxUniqueAccounts) {
            break;
          }
        }

        const openOrdersAccounts = [...accounts]
          .map((s) => new PublicKey(s))
          .sort((a, b) => a.toBuffer().swap64().compare(b.toBuffer().swap64()));

        const instr = DexInstructions.consumeEvents({
          market: spotMarkets[i].publicKey,
          eventQueue: spotMarkets[i]['_decoded'].eventQueue,
          coinFee: baseWallets[i],
          pcFee: quoteWallet,
          openOrdersAccounts,
          limit: consumeEventsLimit,
          programId: serumProgramId,
        });
        const transaction = new Transaction();
        if (priorityMarkets.includes(i) && events.length > priorityQueueLimit) {
          transaction.add(...[
            ComputeBudgetProgram.setComputeUnitLimit({
              units: priorityCuLimit,
            }),
            ComputeBudgetProgram.setComputeUnitPrice({
              microLamports: priorityCuPrice
            })
          ]);
        }
        transaction.add(instr);

        console.log(
          'market',
          i,
          'sending consume events for',
          events.length,
          'events',
        );
        console.log(await connection.sendTransaction(transaction, [payer], {
          skipPreflight: true,
          maxRetries: 2,
        }));
      }
      await sleep(interval);
    } catch (e) {
      console.error(e);
    }
  }
}

run();
