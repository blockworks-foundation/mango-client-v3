import { Connection, PublicKey } from '@solana/web3.js';
import Big from 'big.js';
import BN from 'bn.js';
import {
  BookSide,
  BookSideLayout,
  FillEvent,
  MangoAccount,
  MetaData,
  PerpEventQueue,
  PerpEventQueueLayout,
  PerpMarketConfig,
} from '.';
import { I80F48 } from './fixednum';
import { Modify } from './types';
import { ZERO_BN } from './utils';
import { EOL } from 'os';

export type ParsedFillEvent = Modify<
  FillEvent,
  {
    price: number;
    quantity: number;
  }
>;

export default class PerpMarket {
  metaData!: MetaData;
  publicKey: PublicKey;
  baseDecimals: number;
  quoteDecimals: number;
  mangoGroup!: PublicKey;
  bids!: PublicKey;
  asks!: PublicKey;
  eventQueue!: PublicKey;
  quoteLotSize!: BN;
  baseLotSize!: BN;
  longFunding!: I80F48;
  shortFunding!: I80F48;
  openInterest!: BN;
  lastUpdated!: BN;
  seqNum!: BN;
  feesAccrued!: I80F48;

  // TODO - verify this gets set correctly after parsing
  liquidityMiningInfo!: {
    rate: I80F48;
    maxDepthBps: I80F48;
    periodStart: BN;
    targetPeriodLength: BN;
    mngoLeft: BN;
    mngoPerPeriod: BN;
  };

  mngoVault!: PublicKey;

  constructor(
    publicKey: PublicKey,
    baseDecimals: number,
    quoteDecimals: number,
    decoded: any,
  ) {
    this.publicKey = publicKey;
    this.baseDecimals = baseDecimals;
    this.quoteDecimals = quoteDecimals;
    Object.assign(this, decoded);
  }

  priceLotsToNative(price: BN): I80F48 {
    return I80F48.fromI64(this.quoteLotSize.mul(price)).div(
      I80F48.fromI64(this.baseLotSize),
    );
  }

  baseLotsToNative(quantity: BN): I80F48 {
    return I80F48.fromI64(this.baseLotSize.mul(quantity));
  }

  priceLotsToNumber(price: BN): number {
    const nativeToUi = new Big(10).pow(this.baseDecimals - this.quoteDecimals);
    const lotsToNative = new Big(this.quoteLotSize.toString()).div(
      new Big(this.baseLotSize.toString()),
    );
    return new Big(price.toString())
      .mul(lotsToNative)
      .mul(nativeToUi)
      .toNumber();
  }

  baseLotsToNumber(quantity: BN): number {
    return new Big(quantity.toString())
      .mul(new Big(this.baseLotSize.toString()))
      .div(new Big(10).pow(this.baseDecimals))
      .toNumber();
  }

  get minOrderSize() {
    return this.baseLotsToNumber(new BN(1));
  }

  get tickSize() {
    return this.priceLotsToNumber(new BN(1));
  }

  async loadEventQueue(connection: Connection): Promise<PerpEventQueue> {
    const acc = await connection.getAccountInfo(this.eventQueue);
    const parsed = PerpEventQueueLayout.decode(acc?.data);
    return new PerpEventQueue(parsed);
  }

  async loadFills(connection: Connection): Promise<ParsedFillEvent[]> {
    const q = await this.loadEventQueue(connection);
    // TODO - verify this works
    return q
      .eventsSince(ZERO_BN)
      .map((e) => e.fill)
      .filter((e) => !!e)
      .map(this.parseFillEvent.bind(this)) as ParsedFillEvent[];
  }

  parseFillEvent(event) {
    const quantity = this.baseLotsToNumber(event.quantity);
    const price = this.priceLotsToNumber(event.price);

    return {
      ...event,
      quantity,
      price,
    };
  }

  async loadBids(connection: Connection): Promise<BookSide> {
    const acc = await connection.getAccountInfo(this.bids);
    const book = new BookSide(
      this.bids,
      this,
      BookSideLayout.decode(acc?.data),
    );
    return book;
  }

  async loadAsks(connection: Connection): Promise<BookSide> {
    const acc = await connection.getAccountInfo(this.asks);
    const book = new BookSide(
      this.asks,
      this,
      BookSideLayout.decode(acc?.data),
    );
    return book;
  }

  async loadOrdersForAccount(connection: Connection, account: MangoAccount) {
    const [bids, asks] = await Promise.all([
      this.loadBids(connection),
      this.loadAsks(connection),
    ]);
    // @ts-ignore
    return [...bids, ...asks].filter((order) =>
      order.owner.equals(account.publicKey),
    );
  }
  uiToNativePriceQuantity(price: number, quantity: number): [BN, BN] {
    const baseUnit = Math.pow(10, this.baseDecimals);
    const quoteUnit = Math.pow(10, this.quoteDecimals);

    const nativePrice = new BN(price * quoteUnit)
      .mul(this.baseLotSize)
      .div(this.quoteLotSize.mul(new BN(baseUnit)));
    const nativeQuantity = new BN(quantity * baseUnit).div(this.baseLotSize);
    return [nativePrice, nativeQuantity];
  }

  toPrettyString(perpMarketConfig: PerpMarketConfig): string {
    const lmi = this.liquidityMiningInfo;
    const now = Date.now() / 1000;
    const start = lmi.periodStart.toNumber();
    const elapsed = now - start;
    const progress = 1 - lmi.mngoLeft.toNumber() / lmi.mngoPerPeriod.toNumber();
    const est = start + elapsed / progress;

    const lines: string[] = [
      `${perpMarketConfig.name}`,
      `publicKey: ${perpMarketConfig.publicKey.toBase58()}`,
      `marketIndex: ${perpMarketConfig.marketIndex}`,
      `bidsKey: ${this.bids.toBase58()}`,
      `asksKey: ${this.asks.toBase58()}`,
      `eventQueue: ${this.eventQueue.toBase58()}`,
      `quoteLotSize: ${this.quoteLotSize.toString()}`,
      `baseLotSize: ${this.baseLotSize.toString()}`,
      `longFunding: ${this.longFunding.toString()}`,
      `shortFunding: ${this.shortFunding.toString()}`,
      `openInterest: ${this.openInterest.toString()}`,
      `lastUpdated: ${new Date(
        this.lastUpdated.toNumber() * 1000,
      ).toUTCString()}`,
      `seqNum: ${this.seqNum.toString()}`,
      `feesAccrued: ${this.feesAccrued.toString()}`,
      `\n----- ${perpMarketConfig.name} Liquidity Mining Info -----`,
      `rate: ${lmi.rate.toString()}`,
      `maxDepthBps: ${lmi.maxDepthBps.toString()}`,
      `exp: ${this.metaData.extraInfo || 2}`,
      `periodStart: ${new Date(
        lmi.periodStart.toNumber() * 1000,
      ).toUTCString()}`,
      `targetPeriodLength: ${lmi.targetPeriodLength.toString()}`,
      `mngoLeftInPeriod: ${lmi.mngoLeft.toString()}`,
      `mngoPerPeriod: ${lmi.mngoPerPeriod.toString()}`,
      `periodProgress: ${progress * 100}%`,
      `estPeriodEnd: ${new Date(est * 1000).toUTCString()}`,
    ];

    return lines.join(EOL);
  }
}
