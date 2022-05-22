import * as fs from 'fs';
import WebSocket from 'ws';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  makeCancelAllPerpOrdersInstruction,
  makePlacePerpOrder2Instruction,
} from '../instruction';
import {
  BN,
  Config,
  FillEvent,
  I64_MAX_BN,
  MangoClient,
  PerpEventLayout,
  sleep,
} from '..';

// example:
// LOGFILE_PATH=./log-fills.csv KEYPAIR_PATH=~.config/solana/id.json RPC_URL='https://mango.rpcpool.com/cadcd3f799429565235eaf670d87' MANGO_ACC=your_id MANGO_GROUP=mainnet.1 FILLS_URL=ws://api.mngo.cloud:8080 yarn ts-node src/scripts/benchmarkFills.ts

const {
  LOGFILE_PATH,
  KEYPAIR_PATH,
  RPC_URL,
  MANGO_ACC,
  MANGO_GROUP,
  MANGO_TX_URL,
  FILLS_URL,
} = process.env;

const keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(fs.readFileSync(KEYPAIR_PATH!, 'utf8'))),
);
const fills = new WebSocket(FILLS_URL!);
const rpc = new Connection(RPC_URL!);
const options = MANGO_TX_URL
  ? {
      sendConnection: new Connection(MANGO_TX_URL, {
        disableRetryOnRateLimit: false,
      }),
    }
  : {};
const config = Config.ids().getGroupWithName(MANGO_GROUP!)!;
const mango = new MangoClient(rpc, config.mangoProgramId, options);

const writeResult = (
  resp: string,
  sendTs: number,
  recvTs: number,
  fillTs?: number,
  fill?: FillEvent,
) => {
  const line =
    [sendTs, recvTs, fillTs, fill?.timestamp?.toString(), resp].join(',') +
    '\n';
  fs.appendFileSync(LOGFILE_PATH!, line);
};

(async () => {
  let price: number | undefined;
  let prz, qty;
  const group = await mango.getMangoGroup(config.publicKey);
  const market = await mango.getPerpMarket(
    group.perpMarkets[0].perpMarket,
    config.tokens[1].decimals,
    config.tokens[0].decimals,
  );
  const cache = await group.loadCache(rpc);
  price = group.cachePriceToUi(cache.getPrice(0), 0);
  [prz, qty] = market.uiToNativePriceQuantity(price, 1);
  group.onCacheChange(rpc, (c) => {
    price = group.cachePriceToUi(c.getPrice(0), 0);
    [prz, qty] = market.uiToNativePriceQuantity(price, 1);
    // console.log("benchmark::cache", price);
  });

  const acc = await mango.getMangoAccount(
    new PublicKey(MANGO_ACC!),
    config.serumProgramId,
  );

  const benchmarkInterval = 1000 * 60;
  const benchmarkFn = async () => {
    const orderId = Date.now();
    console.log('benchmark::start', orderId);
    const latest = await rpc.getLatestBlockhash('finalized');
    const tx = new Transaction({
      recentBlockhash: latest.blockhash,
      feePayer: keypair.publicKey,
    });

    tx.add(
      makePlacePerpOrder2Instruction(
        config.mangoProgramId,
        config.publicKey,
        acc.publicKey,
        keypair.publicKey,
        group.mangoCache,
        group.perpMarkets[0].perpMarket,
        market.bids,
        market.asks,
        market.eventQueue,
        acc.getOpenOrdersKeysInBasket(),
        prz,
        qty,
        I64_MAX_BN,
        new BN(orderId),
        orderId % 2 > 0 ? 'buy' : 'sell',
        new BN(50),
        'postOnlySlide',
      ),
      makePlacePerpOrder2Instruction(
        config.mangoProgramId,
        config.publicKey,
        acc.publicKey,
        keypair.publicKey,
        group.mangoCache,
        group.perpMarkets[0].perpMarket,
        market.bids,
        market.asks,
        market.eventQueue,
        acc.getOpenOrdersKeysInBasket(),
        prz,
        qty,
        I64_MAX_BN,
        new BN(orderId + 1),
        orderId % 2 > 0 ? 'sell' : 'buy',
        new BN(50),
        'limit',
      ),
      makeCancelAllPerpOrdersInstruction(
        config.mangoProgramId,
        config.publicKey,
        acc.publicKey,
        keypair.publicKey,
        market.publicKey,
        market.bids,
        market.asks,
        new BN(4),
      ),
    );
    tx.sign(keypair);

    let fillTs: number | undefined;
    let fill: FillEvent | undefined;
    const fillListener = (event) => {
      const parsedEvent = JSON.parse(event.data);
      if (
        parsedEvent['status'] === 'New' &&
        parsedEvent['market'] === 'MNGO-PERP'
      ) {
        const fillBytes = Buffer.from(parsedEvent['event'], 'base64');
        const fillEvent: FillEvent = PerpEventLayout.decode(fillBytes).fill;
        console.log(
          'benchmark::fill',
          fillEvent.timestamp.toNumber(),
          fillEvent.maker.toBase58(),
          fillEvent.taker.toBase58(),
        );

        if (
          (fillEvent.maker.equals(acc.publicKey) &&
            fillEvent.makerClientOrderId.eq(new BN(orderId))) ||
          (fillEvent.taker.equals(acc.publicKey) &&
            fillEvent.takerClientOrderId.eq(new BN(orderId + 1)))
        ) {
          fill = fillEvent;
          fillTs = Date.now();
          console.log('benchmark::fill', fill.timestamp.toNumber(), fillTs);
        }
      }
    };
    fills.addEventListener('message', fillListener);
    const sendTs = Date.now();
    console.log('benchmark::sendTx', sendTs);
    try {
      const resp = await mango.sendSignedTransaction({
        signedTransaction: tx,
        signedAtBlock: latest,
      });
      const confirmTs = Date.now();
      console.log('benchmark::response', resp);
      // wait a few extra seconds for fill to arrive
      await sleep(20000);
      writeResult(resp, sendTs, confirmTs, fillTs, fill);
      console.log('benchmark::end', confirmTs - sendTs);
    } catch (e: any) {
      console.log('benchmark::error', e);
      writeResult(e.toString(), sendTs, 0, fillTs, fill);
    } finally {
      fills.removeEventListener('message', fillListener);
    }
  };
  benchmarkFn();
  setInterval(benchmarkFn, benchmarkInterval);
})();
