import { Market } from '@project-serum/serum';
import {
  Commitment,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { BN } from 'bn.js';
import { MangoClient } from '../client';
import { Cluster, Config } from '../config';
import { makeRecoveryForceSettleSpotOrdersInstruction } from '../instruction';
import { QUOTE_INDEX } from '../layout';
import * as fs from 'fs';
import { sleep } from '../utils/utils';
const config = Config.ids();
const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
const connection = new Connection(
  config.cluster_urls[cluster],
  'confirmed' as Commitment,
);

const groupName = process.env.GROUP || 'devnet.2';
const groupIds = config.getGroup(cluster, groupName)!;

const mangoProgramId = groupIds.mangoProgramId;
const mangoGroupKey = groupIds.publicKey;
const client = new MangoClient(connection, mangoProgramId);

const payer = Keypair.fromSecretKey(
  new Uint8Array(
    JSON.parse(
      fs.readFileSync('/Users/riordan/.config/solana/devnet.json', 'utf-8'),
    ),
  ),
);

let firstTx: string;
let lastTx: string;

async function settle() {
  const group = await client.getMangoGroup(mangoGroupKey);
  await group.loadRootBanks(connection);
  const accounts = await client.getAllMangoAccounts(group, undefined, true);
  const quoteRootBank = group.rootBankAccounts[QUOTE_INDEX]!;
  const serumMarkets = await Promise.all(
    groupIds.spotMarkets.map((m) =>
      Market.load(connection, m.publicKey, undefined, group.dexProgramId),
    ),
  );
let count = 0;
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    for (let market of groupIds.spotMarkets) {
      const marketIndex = market.marketIndex;
      const rootBank = group.rootBankAccounts[marketIndex]!;
      const serumMarket = serumMarkets.find((m) =>
        m.publicKey.equals(market.publicKey),
      )!;

      if (!account.inMarginBasket[marketIndex]) continue;
      console.log(`Processing account ${account.publicKey} (${i}/${accounts.length})`);
      const tx = new Transaction();
      const dexSigner = await PublicKey.createProgramAddress(
        [
          serumMarket.publicKey.toBuffer(),
          serumMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
        ],
        group.dexProgramId,
      );
      const openOrders = account.spotOpenOrders.map((oo, i) => {
        return { pubkey: oo, isWritable: i == marketIndex };
      });

      tx.add(
        makeRecoveryForceSettleSpotOrdersInstruction(
          groupIds.mangoProgramId,
          group.publicKey,
          account.publicKey,
          rootBank.publicKey,
          rootBank.nodeBanks[0],
          rootBank.nodeBankAccounts[0].vault,
          quoteRootBank.publicKey,
          quoteRootBank.nodeBanks[0],
          quoteRootBank.nodeBankAccounts[0].vault,
          market.publicKey,
          market.bidsKey,
          market.asksKey,
          group.signerKey,
          serumMarket['_decoded'].eventQueue,
          serumMarket['_decoded'].baseVault,
          serumMarket['_decoded'].quoteVault,
          dexSigner,
          group.dexProgramId,
          new BN(16),
          openOrders,
        ),
      );

      let txid = await client.sendTransaction(tx, payer, []);
      if (!firstTx) {
        firstTx = txid;
      }
      lastTx = txid;
      if (count > 2) i = accounts.length;
      count++;
    }
  }
  console.log('collecting logs...')
  console.log('firstTx', firstTx);
  console.log('lastTx', lastTx);
  await sleep(10000);
  await collectTransactions(lastTx, firstTx);
}

const regex = /Program log: recovery-settle: (?<pre_base>.+) (?<pre_quote>.+) (?<post_base>.+) (?<post_quote>.+)/;
const limit = 64;
async function collectTransactions(before: string, until: string) {
  console.log(before, until)
  const signatures = await connection.getConfirmedSignaturesForAddress2(
    payer.publicKey,
    {
      before,
      until,
      limit,
    },
  );

  const txs = await connection.getTransactions(
    [before, until].concat(signatures.map((s) => s.signature)),
  );
  console.log(txs.length)

  txs.forEach((tx) => {
    let log = tx?.meta?.logMessages
      ?.map((m) => m.match(regex)?.groups)
      .filter((m) => m != undefined)![0]!;
    if(!log) return;

    let preBase = parseInt(log['pre_base']);
    let preQuote = parseInt(log['pre_quote']);
    let postBase = parseInt(log['post_base']);
    let postQuote = parseInt(log['post_quote']);
    const mangoAccountIndex = tx?.transaction.message.instructions[0].accounts[1]!;
    console.log(tx?.transaction.message.accountKeys[mangoAccountIndex], tx?.transaction.signatures[0], `(${preBase},${preQuote}) (${postBase},${postQuote})`);
  });

  if (signatures.length == limit) {
    collectTransactions(signatures[limit - 1].signature, until);
  }
}

settle();
//collectTransactions('3Ko3ejzZZXwWkNKKZx9qyypvTa7cr9oJJATv1m2Qh1Cq2Xh7H6inm8Qzcx1pQGvKjqJ6ve7TR74ir7K8Gz7amVHG', '54meY8ZcVvE2NDi9Uj54QPu6PvfKG2suf7X43xEj4eXJm6bYWjQjqusj8ytf9HUg3zRtLNJCewjkdaPkVSvPD4gk')
