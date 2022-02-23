import { Connection, PublicKey } from '@solana/web3.js';
import Big from 'big.js';
import BN from 'bn.js';
import {
  BookSide,
  BookSideLayout,
  clamp,
  FillEvent,
  MangoAccount,
  MangoCache,
  MetaData,
  nativeToUi,
  ONE_BN,
  PerpEventQueue,
  PerpEventQueueLayout,
  PerpMarketConfig,
} from '.';
import { I80F48 } from './utils/fixednum';
import { Modify } from './utils/types';
import { ZERO_BN } from './utils/utils';
import { EOL } from 'os';
import MangoGroup from './MangoGroup';

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
  priceLotsToUiConvertor: number;
  baseLotsToUiConvertor: number;
  _tickSize: number | undefined;
  _minOrderSize: number | undefined;
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

    this.priceLotsToUiConvertor = new Big(10)
      .pow(baseDecimals - quoteDecimals)
      .mul(new Big(this.quoteLotSize.toString()))
      .div(new Big(this.baseLotSize.toString()))
      .toNumber();

    this.baseLotsToUiConvertor = new Big(this.baseLotSize.toString())
      .div(new Big(10).pow(baseDecimals))
      .toNumber();
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
    return parseFloat(price.toString()) * this.priceLotsToUiConvertor;
  }

  baseLotsToNumber(quantity: BN): number {
    return parseFloat(quantity.toString()) * this.baseLotsToUiConvertor;
  }

  get minOrderSize(): number {
    if (this._minOrderSize === undefined) {
      this._minOrderSize = this.baseLotsToNumber(ONE_BN);
    }
    return this._minOrderSize;
  }

  get tickSize(): number {
    if (this._tickSize === undefined) {
      this._tickSize = this.priceLotsToNumber(ONE_BN);
    }
    return this._tickSize;
  }

  /**
   * Calculate the instantaneous funding rate using the bids and asks
   * Reported as an hourly number
   * Make sure `cache`, `bids` and `asks` are up to date
   */
  getCurrentFundingRate(
    group: MangoGroup,
    cache: MangoCache,
    marketIndex: number,
    bids: BookSide,
    asks: BookSide,
  ) {
    const IMPACT_QUANTITY = new BN(100);
    const MIN_FUNDING = -0.05;
    const MAX_FUNDING = 0.05;
    const bid = bids.getImpactPriceUi(IMPACT_QUANTITY);
    const ask = asks.getImpactPriceUi(IMPACT_QUANTITY);
    const indexPrice = group.getPriceUi(marketIndex, cache);

    let diff;
    if (bid !== undefined && ask !== undefined) {
      const bookPrice = (bid + ask) / 2;
      diff = clamp(bookPrice / indexPrice - 1, MIN_FUNDING, MAX_FUNDING);
    } else if (bid !== undefined) {
      diff = MAX_FUNDING;
    } else if (ask !== undefined) {
      diff = MIN_FUNDING;
    } else {
      diff = 0;
    }
    return diff / 24;
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

  async loadBids(
    connection: Connection,
    includeExpired: boolean = false,
  ): Promise<BookSide> {
    const acc = await connection.getAccountInfo(this.bids);
    return new BookSide(
      this.bids,
      this,
      BookSideLayout.decode(acc?.data),
      includeExpired,
    );
  }

  async loadAsks(
    connection: Connection,
    includeExpired: boolean = false,
  ): Promise<BookSide> {
    const acc = await connection.getAccountInfo(this.asks);
    return new BookSide(
      this.asks,
      this,
      BookSideLayout.decode(acc?.data),
      includeExpired,
    );
  }

  async loadOrdersForAccount(
    connection: Connection,
    account: MangoAccount,
    includeExpired: boolean = false,
  ) {
    const [bids, asks] = await Promise.all([
      this.loadBids(connection, includeExpired),
      this.loadAsks(connection, includeExpired),
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

  uiQuoteToLots(uiQuote: number): BN {
    const quoteUnit = Math.pow(10, this.quoteDecimals);
    return new BN(uiQuote * quoteUnit).div(this.quoteLotSize);
  }
  toPrettyString(
    group: MangoGroup,
    perpMarketConfig: PerpMarketConfig,
  ): string {
    const info = group.perpMarkets[perpMarketConfig.marketIndex];
    const oracle = group.oracles[perpMarketConfig.marketIndex];
    const lmi = this.liquidityMiningInfo;
    const now = Date.now() / 1000;
    const start = lmi.periodStart.toNumber();
    const elapsed = now - start;
    const progress = 1 - lmi.mngoLeft.toNumber() / lmi.mngoPerPeriod.toNumber();
    const est = start + elapsed / progress;

    const lines: string[] = [
      `${perpMarketConfig.name}`,
      `version: ${this.metaData.version}`,
      `publicKey: ${perpMarketConfig.publicKey.toBase58()}`,
      `oracle: ${oracle.toBase58()}`,
      `initAssetWeight: ${group.perpMarkets[
        perpMarketConfig.marketIndex
      ].initAssetWeight.toString()}`,
      `maintAssetWeight: ${group.perpMarkets[
        perpMarketConfig.marketIndex
      ].maintAssetWeight.toString()}`,
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
      `liquidationFee: ${info.liquidationFee.toString()}`,
      `takerFee: ${info.takerFee.toString()}`,
      `makerFee: ${info.makerFee.toString()}`,
      `feesAccrued: ${nativeToUi(this.feesAccrued.toNumber(), 6).toFixed(6)}`,
      `\n----- ${perpMarketConfig.name} Liquidity Mining Info -----`,
      `rate: ${lmi.rate.toString()}`,
      `maxDepth: ${
        this.metaData.version === 0
          ? lmi.maxDepthBps.toString() + ' bps'
          : lmi.maxDepthBps.toString() + ' contracts'
      }`,
      `exp: ${this.metaData.extraInfo[0] || 2}`,
      `lmSizeShift: ${this.metaData.extraInfo[1]}`,
      `periodStart: ${new Date(
        lmi.periodStart.toNumber() * 1000,
      ).toUTCString()}`,
      `targetPeriodLength: ${lmi.targetPeriodLength.toString()}`,
      `mngoLeftInPeriod: ${(lmi.mngoLeft.toNumber() / Math.pow(10, 6)).toFixed(
        2,
      )}`,
      `mngoPerPeriod: ${(
        lmi.mngoPerPeriod.toNumber() / Math.pow(10, 6)
      ).toFixed(2)}`,
      `periodProgress: ${progress * 100}%`,
      `estPeriodEnd: ${new Date(est * 1000).toUTCString()}`,
      `mngoVault: ${this.mngoVault.toString()}`,
    ];

    return lines.join(EOL);
  }
}
