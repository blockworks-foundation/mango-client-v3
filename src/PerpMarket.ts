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
  longFunding!: I80F48;
  shortFunding!: I80F48;
  openInterest!: BN;
  quoteLotSize!: BN;
  indexOracle!: PublicKey;
  lastUpdated!: BN;
  seqNum!: BN;
  contractSize!: BN;

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
      I80F48.fromI64(this.contractSize),
    );
  }

  baseLotsToNative(quantity: BN): I80F48 {
    return I80F48.fromI64(this.contractSize.mul(quantity));
  }

  priceLotsToNumber(price: BN | number): number {
    const nativeToUi = new Big(10).pow(this.baseDecimals - this.quoteDecimals);
    const lotsToNative = new Big(this.quoteLotSize).div(
      new Big(this.contractSize),
    );
    return new Big(price).mul(lotsToNative).mul(nativeToUi).toNumber();
  }

  baseLotsToNumber(quantity: BN | number): number {
    return new Big(quantity)
      .mul(new Big(this.contractSize))
      .div(new Big(10).pow(this.baseDecimals))
      .toNumber();
  }

  parseFillEvent(event) {
    let side;

    if (event.quoteChange.negative == 1) {
      side = 'buy';
    } else {
      side = 'sell';
    }
    return {
      ...event,
      side,
      price: Math.abs(this.priceLotsToNumber(event.quoteChange)),
      size: Math.abs(this.baseLotsToNumber(event.baseChange)),
    };
  }

  async loadEventQueue(connection: Connection): Promise<PerpEventQueue> {
    const acc = await connection.getAccountInfo(this.eventQueue);
    const parsed = PerpEventQueueLayout.decode(acc?.data);
    return new PerpEventQueue(parsed);
  }

  async loadFills(connection: Connection): Promise<FillEvent[]> {
    const q = await this.loadEventQueue(connection);
    return q
      .eventsSince(new BN(0))
      .map((e) => e.fill)
      .filter((e) => !!e)
      .map(this.parseFillEvent.bind(this)) as FillEvent[];
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
