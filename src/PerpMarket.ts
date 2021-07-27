import { Connection, PublicKey } from '@solana/web3.js';
import Big from 'big.js';
import BN from 'bn.js';
import {
  BookSide,
  BookSideLayout,
  FillEvent,
  MangoAccount,
  PerpEventQueue,
  PerpEventQueueLayout,
} from '.';
import { I80F48 } from './fixednum';

export default class PerpMarket {
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

  async loadEventQueue(connection: Connection): Promise<PerpEventQueue> {
    const acc = await connection.getAccountInfo(this.eventQueue);
    const parsed = PerpEventQueueLayout.decode(acc?.data);
    return new PerpEventQueue(parsed);
  }

  async loadFills(connection: Connection): Promise<FillEvent[]> {
    const q = await this.loadEventQueue(connection);
    // TODO - verify this works
    return q
      .eventsSince(new BN(0))
      .map((e) => e.fill)
      .filter((e) => !!e) as FillEvent[];
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
    return [...bids, ...asks].filter(
      (order) => order.owner === account.publicKey,
    );
  }
}
