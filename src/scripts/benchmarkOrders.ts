import * as fs from 'fs';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  BN,
  Config,
  I64_MAX_BN,
  makeCancelAllPerpOrdersInstruction,
  makePlacePerpOrder2Instruction,
  MangoClient,
} from '..';

// example:
// LOGFILE_PATH=./log-fills.csv KEYPAIR_PATH=~.config/solana/id.json RPC_URL='https://mango.rpcpool.com/cadcd3f799429565235eaf670d87' MANGO_ACC=your_id MANGO_GROUP=mainnet.1 yarn ts-node src/scripts/benchmarkOrders.ts

const {
  LOGFILE_PATH,
  KEYPAIR_PATH,
  RPC_URL,
  MANGO_ACC,
  MANGO_GROUP,
  MANGO_TX_URL,
} = process.env;

const keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(fs.readFileSync(KEYPAIR_PATH!, 'utf8'))),
);
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

const writeResult = (resp: string, sendTs: number, confirmTs: number) => {
  const line = [sendTs, confirmTs, confirmTs - sendTs, resp].join(',') + '\n';
  fs.appendFileSync(LOGFILE_PATH!, line);
};

(async () => {
  let price: number | undefined;
  let prz: BN, qty: BN;
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

  const benchmarkInterval = 200;
  const benchmarkFn = async () => {
    const orderId = Date.now();
    console.log('benchmark::start', orderId);
    const latest = await rpc.getLatestBlockhash('finalized');
    const tx = new Transaction({
      recentBlockhash: latest.blockhash,
      feePayer: keypair.publicKey,
    });

    tx.add(
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
        prz.divn(2),
        qty,
        I64_MAX_BN,
        new BN(orderId),
        'buy',
        new BN(250),
        'postOnly',
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
        prz.muln(2),
        qty,
        I64_MAX_BN,
        new BN(orderId + 1),
        'sell',
        new BN(250),
        'postOnly',
      ),
    );
    tx.sign(keypair);

    const sendTs = Date.now();
    console.log('benchmark::sendTx', sendTs);
    try {
      const resp = await mango.sendSignedTransaction({
        signedTransaction: tx,
        signedAtBlock: latest,
      });
      const confirmTs = Date.now();
      console.log('benchmark::response', confirmTs - sendTs, resp);
      writeResult(resp, sendTs, confirmTs);
    } catch (e: any) {
      console.log('benchmark::error', e);
      writeResult(e.toString(), sendTs, 0);
    }
  };
  benchmarkFn();
  setInterval(benchmarkFn, benchmarkInterval);
})();
