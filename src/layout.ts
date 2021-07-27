import {
  struct,
  u32,
  u8,
  u16,
  union,
  seq,
  blob,
  Blob,
  Structure,
  Layout,
  UInt,
  offset,
  greedy,
  nu64,
} from 'buffer-layout';
import { PublicKey } from '@solana/web3.js';
import { I80F48 } from './fixednum';
import BN from 'bn.js';
import { zeroKey } from './utils';

export const MAX_TOKENS = 32;
export const MAX_PAIRS = MAX_TOKENS - 1;
export const MAX_NODE_BANKS = 8;
export const INFO_LEN = 32;

const MAX_BOOK_NODES = 1024;

class _I80F48Layout extends Blob {
  constructor(property: string) {
    super(16, property);
  }

  decode(b, offset) {
    let result = new BN(super.decode(b, offset), 10, 'le');
    result = result.fromTwos(8 * this['length']);
    return new I80F48(result);
  }

  encode(src, b, offset) {
    src = src.toTwos(8 * this['length']);
    return super.encode(src.toArrayLike(Buffer, 'le', this['span']), b, offset);
  }
}
export function I80F48Layout(property = '') {
  return new _I80F48Layout(property);
}

class BNLayout extends Blob {
  signed: boolean;

  constructor(number: number, property, signed = false) {
    super(number, property);
    this.signed = signed;

    // restore prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }

  decode(b, offset) {
    let result = new BN(super.decode(b, offset), 10, 'le');
    if (this.signed) result = result.fromTwos(8 * this['length']);
    return result;
  }

  encode(src, b, offset) {
    if (this.signed) src = src.toTwos(8 * this['length']);
    return super.encode(src.toArrayLike(Buffer, 'le', this['span']), b, offset);
  }
}

export function u64(property = '') {
  return new BNLayout(8, property);
}

export function i64(property = '') {
  return new BNLayout(8, property, true);
}

export function u128(property?: string) {
  return new BNLayout(16, property);
}

export function i128(property?: string) {
  return new BNLayout(16, property, true);
}

class WrappedLayout<T, U> extends Layout<U> {
  layout: Layout<T>;
  decoder: (data: T) => U;
  encoder: (src: U) => T;

  constructor(
    layout: Layout<T>,
    decoder: (data: T) => U,
    encoder: (src: U) => T,
    property?: string,
  ) {
    super(layout.span, property);
    this.layout = layout;
    this.decoder = decoder;
    this.encoder = encoder;
  }

  decode(b: Buffer, offset?: number): U {
    return this.decoder(this.layout.decode(b, offset));
  }

  encode(src: U, b: Buffer, offset?: number): number {
    return this.layout.encode(this.encoder(src), b, offset);
  }

  getSpan(b: Buffer, offset?: number): number {
    return this.layout.getSpan(b, offset);
  }
}

export function bool(property?: string) {
  return new WrappedLayout(u8(), decodeBool, encodeBool, property);
}

function decodeBool(value: number): boolean {
  if (value === 0) {
    return false;
  } else if (value === 1) {
    return true;
  }
  throw new Error('Invalid bool: ' + value);
}

function encodeBool(value: boolean): number {
  return value ? 1 : 0;
}

class EnumLayout extends UInt {
  values: any;
  constructor(values, span, property) {
    super(span, property);
    this.values = values;
  }
  encode(src, b, offset) {
    if (this.values[src] !== undefined) {
      return super.encode(this.values[src], b, offset);
    }
    throw new Error('Invalid ' + this['property']);
  }

  decode(b, offset) {
    const decodedValue = super.decode(b, offset);
    const entry = Object.entries(this.values).find(
      ([, value]) => value === decodedValue,
    );
    if (entry) {
      return entry[0];
    }
    throw new Error('Invalid ' + this['property']);
  }
}

export function sideLayout(property, span) {
  return new EnumLayout({ buy: 0, sell: 1 }, span, property);
}

export function orderTypeLayout(property, span) {
  return new EnumLayout({ limit: 0, ioc: 1, postOnly: 2 }, span, property);
}

export function selfTradeBehaviorLayout(property) {
  return new EnumLayout(
    { decrementTake: 0, cancelProvide: 1, abortTransaction: 2 },
    4,
    property,
  );
}

/**
 * Need to implement layouts for each of the structs found in state.rs
 */
export const MangoInstructionLayout = union(u32('instruction'));
MangoInstructionLayout.addVariant(
  0,
  struct([
    u64('signerNonce'),
    u64('validInterval'),
    I80F48Layout('quoteOptimalUtil'),
    I80F48Layout('quoteOptimalRate'),
    I80F48Layout('quoteMaxRate'),
  ]),
  'InitMangoGroup',
);
MangoInstructionLayout.addVariant(1, struct([]), 'InitMangoAccount');
MangoInstructionLayout.addVariant(2, struct([u64('quantity')]), 'Deposit');
MangoInstructionLayout.addVariant(
  3,
  struct([u64('quantity'), u8('allowBorrow')]),
  'Withdraw',
);
MangoInstructionLayout.addVariant(
  4,
  struct([
    u64('marketIndex'),
    u128('maintLeverage'),
    u128('initLeverage'),
    I80F48Layout('optimalUtil'),
    I80F48Layout('optimalRate'),
    I80F48Layout('maxRate'),
  ]),
  'AddSpotMarket',
);
MangoInstructionLayout.addVariant(
  5,
  struct([u64('marketIndex')]),
  'AddToBasket',
);
MangoInstructionLayout.addVariant(6, struct([u64('quantity')]), 'Borrow');
MangoInstructionLayout.addVariant(7, struct([]), 'CachePrices');
MangoInstructionLayout.addVariant(8, struct([]), 'CacheRootBanks');
MangoInstructionLayout.addVariant(
  9,
  struct([
    sideLayout('side', 4),
    u64('limitPrice'),
    u64('maxBaseQuantity'),
    u64('maxQuoteQuantity'),
    selfTradeBehaviorLayout('selfTradeBehavior'),
    orderTypeLayout('orderType', 4),
    u64('clientId'),
    u16('limit'),
  ]),
  'PlaceSpotOrder',
);
MangoInstructionLayout.addVariant(10, struct([]), 'AddOracle');
MangoInstructionLayout.addVariant(
  11,
  struct([
    u64('marketIndex'),
    I80F48Layout('maintLeverage'),
    I80F48Layout('initLeverage'),
    I80F48Layout('liquidationFee'),
    I80F48Layout('makerFee'),
    I80F48Layout('takerFee'),
    i64('baseLotSize'),
    i64('quoteLotSize'),
    I80F48Layout('rate'),
    I80F48Layout('maxDepthBps'),
    u64('targetPeriodLength'),
    u64('mngoPerPeriod'),
  ]),
  'AddPerpMarket',
);
MangoInstructionLayout.addVariant(
  12,
  struct([
    i64('price'),
    i64('quantity'),
    u64('clientOrderId'),
    sideLayout('side', 1),
    orderTypeLayout('orderType', 1),
  ]),
  'PlacePerpOrder',
);
MangoInstructionLayout.addVariant(
  13,
  struct([u64('clientOrderId')]),
  'CancelPerpOrderByClientId',
);
MangoInstructionLayout.addVariant(
  14,
  struct([i128('orderId'), sideLayout('side', 4)]),
  'CancelPerpOrder',
);
MangoInstructionLayout.addVariant(15, struct([u64('limit')]), 'ConsumeEvents');
MangoInstructionLayout.addVariant(16, struct([]), 'CachePerpMarkets');
MangoInstructionLayout.addVariant(17, struct([]), 'UpdateFunding');
MangoInstructionLayout.addVariant(
  18,
  struct([I80F48Layout('price')]),
  'SetOracle',
);
MangoInstructionLayout.addVariant(19, struct([]), 'SettleFunds');
MangoInstructionLayout.addVariant(
  20,
  struct([sideLayout('side', 4), u128('orderId')]),
  'CancelSpotOrder',
);
MangoInstructionLayout.addVariant(21, struct([]), 'UpdateRootBank');
MangoInstructionLayout.addVariant(
  22,
  struct([u64('marketIndex')]),
  'SettlePnl',
);
MangoInstructionLayout.addVariant(
  23,
  struct([u64('tokenIndex'), u64('quantity')]),
  'SettleBorrow',
);
MangoInstructionLayout.addVariant(
  24,
  struct([u8('limit')]),
  'ForceCancelSpotOrders',
);
MangoInstructionLayout.addVariant(
  25,
  struct([u8('limit')]),
  'ForceCancelPerpOrders',
);
MangoInstructionLayout.addVariant(
  26,
  struct([I80F48Layout('maxLiabTransfer')]),
  'LiquidateTokenAndToken',
);
MangoInstructionLayout.addVariant(
  27,
  struct([
    u8('assetType'),
    u64('assetIndex'),
    u8('liabType'),
    u64('liabIndex'),
    I80F48Layout('maxLiabTransfer'),
  ]),
  'LiquidateTokenAndPerp',
);
MangoInstructionLayout.addVariant(
  28,
  struct([i64('baseTransferRequest')]),
  'LiquidatePerpMarket',
);
MangoInstructionLayout.addVariant(29, struct([]), 'SettleFees');
MangoInstructionLayout.addVariant(
  30,
  struct([u64('liabIndex'), I80F48Layout('maxLiabTransfer')]),
  'ResolvePerpBankruptcy',
);
MangoInstructionLayout.addVariant(
  31,
  struct([I80F48Layout('maxLiabTransfer')]),
  'ResolveTokenBankruptcy',
);
MangoInstructionLayout.addVariant(32, struct([]), 'InitSpotOpenOrders');

const instructionMaxSpan = Math.max(
  // @ts-ignore
  ...Object.values(MangoInstructionLayout.registry).map((r) => r.span),
);
export function encodeMangoInstruction(data) {
  const b = Buffer.alloc(instructionMaxSpan);
  const span = MangoInstructionLayout.encode(data, b);
  return b.slice(0, span);
}

export class PublicKeyLayout extends Blob {
  constructor(property) {
    super(32, property);
  }

  decode(b, offset) {
    return new PublicKey(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}
export function publicKeyLayout(property = '') {
  return new PublicKeyLayout(property);
}

export const DataType = {
  MangoGroup: 0,
  MangoAccount: 1,
  RootBank: 2,
  NodeBank: 3,
  PerpMarket: 4,
  Bids: 5,
  Asks: 6,
  MangoCache: 7,
  EventQueue: 8,
};

export const enum AssetType {
  Token = 0,
  Perp = 1,
}

export class MetaData {
  dataType!: number;
  version!: number;
  isInitialized!: boolean;

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }
}

export class MetaDataLayout extends Structure {
  constructor(property) {
    super(
      [
        u8('dataType'),
        u8('version'),
        u8('isInitialized'),
        seq(u8(), 5, 'padding'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new MetaData(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}
export function metaDataLayout(property = '') {
  return new MetaDataLayout(property);
}

export class TokenInfo {
  mint!: PublicKey;
  rootBank!: PublicKey;
  decimals!: number;
  padding!: number[];

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }
  isEmpty(): boolean {
    return this.mint.equals(zeroKey);
  }
}

export class TokenInfoLayout extends Structure {
  constructor(property) {
    super(
      [
        publicKeyLayout('mint'),
        publicKeyLayout('rootBank'),
        u8('decimals'),
        seq(u8(), 7, 'padding'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new TokenInfo(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}

export function tokenInfoLayout(property = '') {
  return new TokenInfoLayout(property);
}

export class SpotMarketInfo {
  spotMarket!: PublicKey;
  maintAssetWeight!: I80F48;
  initAssetWeight!: I80F48;
  maintLiabWeight!: I80F48;
  initLiabWeight!: I80F48;
  liquidationFee!: I80F48;

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }

  isEmpty(): boolean {
    return this.spotMarket.equals(zeroKey);
  }
}

export class SpotMarketInfoLayout extends Structure {
  constructor(property) {
    super(
      [
        publicKeyLayout('spotMarket'),
        I80F48Layout('maintAssetWeight'),
        I80F48Layout('initAssetWeight'),
        I80F48Layout('maintLiabWeight'),
        I80F48Layout('initLiabWeight'),
        I80F48Layout('liquidationFee'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new SpotMarketInfo(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}

export function spotMarketInfoLayout(property = '') {
  return new SpotMarketInfoLayout(property);
}

export class PerpMarketInfo {
  perpMarket!: PublicKey;
  maintAssetWeight!: I80F48;
  initAssetWeight!: I80F48;
  maintLiabWeight!: I80F48;
  initLiabWeight!: I80F48;
  liquidationFee!: I80F48;
  makerFee!: I80F48;
  takerFee!: I80F48;
  baseLotSize!: BN;
  quoteLotSize!: BN;

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }
  isEmpty(): boolean {
    return this.perpMarket.equals(zeroKey);
  }
}

export class PerpMarketInfoLayout extends Structure {
  constructor(property) {
    super(
      [
        publicKeyLayout('perpMarket'),
        I80F48Layout('maintAssetWeight'),
        I80F48Layout('initAssetWeight'),
        I80F48Layout('maintLiabWeight'),
        I80F48Layout('initLiabWeight'),
        I80F48Layout('liquidationFee'),
        I80F48Layout('makerFee'),
        I80F48Layout('takerFee'),
        i64('baseLotSize'),
        i64('quoteLotSize'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new PerpMarketInfo(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}

export function perpMarketInfoLayout(property = '') {
  return new PerpMarketInfoLayout(property);
}

export class PerpAccount {
  basePosition!: BN;
  quotePosition!: I80F48;
  longSettledFunding!: I80F48;
  shortSettledFunding!: I80F48;
  openOrders!: PerpOpenOrders;
  liquidityPoints!: I80F48;

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }

  getPnl(perpMarketInfo: PerpMarketInfo, price: I80F48): I80F48 {
    return I80F48.fromI64(this.basePosition.mul(perpMarketInfo.baseLotSize))
      .mul(price)
      .add(this.quotePosition);
  }

  simPositionHealth(
    perpMarketInfo: PerpMarketInfo,
    price: I80F48,
    assetWeight: I80F48,
    liabWeight: I80F48,
    baseChange: BN,
  ): I80F48 {
    const newBase = this.basePosition.add(baseChange);
    let health = this.quotePosition.sub(
      I80F48.fromI64(baseChange.mul(perpMarketInfo.baseLotSize)).mul(price),
    );
    if (newBase.gt(new BN(0))) {
      health = health.add(
        I80F48.fromI64(newBase.mul(perpMarketInfo.baseLotSize))
          .mul(price)
          .mul(assetWeight),
      );
    } else {
      health = health.add(
        I80F48.fromI64(newBase.mul(perpMarketInfo.baseLotSize))
          .mul(price)
          .mul(liabWeight),
      );
    }
    return health;
  }

  getHealth(
    perpMarketInfo: PerpMarketInfo,
    price: I80F48,
    assetWeight: I80F48,
    liabWeight: I80F48,
    longFunding: I80F48,
    shortFunding: I80F48,
  ): I80F48 {
    const bidsHealth = this.simPositionHealth(
      perpMarketInfo,
      price,
      assetWeight,
      liabWeight,
      this.openOrders.bidsQuantity,
    );

    const asksHealth = this.simPositionHealth(
      perpMarketInfo,
      price,
      assetWeight,
      liabWeight,
      this.openOrders.asksQuantity.neg(),
    );
    const health = bidsHealth.lt(asksHealth) ? bidsHealth : asksHealth;

    let x;
    if (this.basePosition.gt(new BN(0))) {
      x = health.sub(
        longFunding
          .sub(this.longSettledFunding)
          .mul(I80F48.fromI64(this.basePosition)),
      );
    } else {
      x = health.add(
        shortFunding
          .sub(this.shortSettledFunding)
          .mul(I80F48.fromI64(this.basePosition)),
      );
    }
    return x;
  }
}

export class PerpAccountLayout extends Structure {
  constructor(property) {
    super(
      [
        i64('basePosition'),
        I80F48Layout('quotePosition'),
        I80F48Layout('longSettledFunding'),
        I80F48Layout('shortSettledFunding'),
        perpOpenOrdersLayout('openOrders'),
        I80F48Layout('liquidityPoints'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new PerpAccount(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}

export function perpAccountLayout(property = '') {
  return new PerpAccountLayout(property);
}
export class PerpOpenOrders {
  bidsQuantity!: BN;
  asksQuantity!: BN;
  isFreeBits!: BN;
  isBidBits!: BN;
  orders!: BN[];
  clientOrderIds!: BN[];

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }
}

export class PerpOpenOrdersLayout extends Structure {
  constructor(property) {
    super(
      [
        i64('bidsQuantity'),
        i64('asksQuantity'),
        u32('isFreeBits'),
        u32('isBidBits'),
        seq(i128(), MAX_TOKENS, 'orders'),
        seq(u64(), MAX_TOKENS, 'clientOrderIds'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new PerpOpenOrders(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}

export function perpOpenOrdersLayout(property = '') {
  return new PerpOpenOrdersLayout(property);
}

export const MangoGroupLayout = struct([
  metaDataLayout('metaData'),
  u64('numOracles'), //usize?

  seq(tokenInfoLayout(), MAX_TOKENS, 'tokens'),
  seq(spotMarketInfoLayout(), MAX_PAIRS, 'spotMarkets'),
  seq(perpMarketInfoLayout(), MAX_PAIRS, 'perpMarkets'),

  seq(publicKeyLayout(), MAX_PAIRS, 'oracles'),

  u64('signerNonce'),
  publicKeyLayout('signerKey'),
  publicKeyLayout('admin'),
  publicKeyLayout('dexProgramId'),
  publicKeyLayout('mangoCache'),
  u64('validInterval'),
  publicKeyLayout('daoVault'),
  publicKeyLayout('srmVault'),
  publicKeyLayout('msrmVault'),
  seq(u8(), 64, 'padding'),
]);

export const MangoAccountLayout = struct([
  metaDataLayout('metaData'),
  publicKeyLayout('mangoGroup'),
  publicKeyLayout('owner'),
  seq(bool(), MAX_PAIRS, 'inMarginBasket'),
  u8('numInMarginBasket'),
  seq(I80F48Layout(), MAX_TOKENS, 'deposits'),
  seq(I80F48Layout(), MAX_TOKENS, 'borrows'),
  seq(publicKeyLayout(), MAX_PAIRS, 'spotOpenOrders'),
  seq(perpAccountLayout(), MAX_PAIRS, 'perpAccounts'),
  u64('msrmAmount'),

  bool('beingLiquidated'),
  bool('isBankrupt'),
  seq(u8(), INFO_LEN, 'info'),
  seq(u8(), 70, 'padding'),
]);

export const RootBankLayout = struct([
  metaDataLayout('metaData'),
  I80F48Layout('optimalUtil'),
  I80F48Layout('optimalRate'),
  I80F48Layout('maxRate'),
  u64('numNodeBanks'), // usize?
  seq(publicKeyLayout(), MAX_NODE_BANKS, 'nodeBanks'),
  I80F48Layout('depositIndex'),
  I80F48Layout('borrowIndex'),
  u64('lastUpdated'),
  seq(u8(), 64, 'padding'),
]);

export const NodeBankLayout = struct([
  metaDataLayout('metaData'),
  I80F48Layout('deposits'),
  I80F48Layout('borrows'),
  publicKeyLayout('vault'),
]);

export const StubOracleLayout = struct([
  seq(u8(), 8),
  I80F48Layout('price'),
  u64('lastUpdate'),
]);

export const LiquidityMiningInfoLayout = struct([
  I80F48Layout('rate'),
  I80F48Layout('maxDepthBps'),

  u64('periodStart'),
  u64('targetPeriodLength'),
  u64('mngoLeft'),
  u64('mngoPerPeriod'),
]);

export const PerpMarketLayout = struct([
  metaDataLayout('metaData'),
  publicKeyLayout('mangoGroup'),
  publicKeyLayout('bids'),
  publicKeyLayout('asks'),
  publicKeyLayout('eventQueue'),
  i64('quoteLotSize'),
  i64('baseLotSize'),

  I80F48Layout('longFunding'),
  I80F48Layout('shortFunding'),
  i64('openInterest'),
  u64('lastUpdated'),
  u64('seqNum'),
  I80F48Layout('feesAccrued'),
  LiquidityMiningInfoLayout('liquidityMiningInfo'),
  publicKeyLayout('mngoVault'),
]);

export const PerpEventLayout = union(u8('eventType'), blob(151), 'event');
PerpEventLayout.addVariant(
  0,
  struct([
    sideLayout('side', 1),
    u8('makerSlot'),
    bool('makerOut'),
    seq(u8(), 4),
    publicKeyLayout('maker'),
    i128('makerOrderId'),
    u64('makerClientOrderId'),
    i64('bestInitial'),
    u64('timestamp'),

    publicKeyLayout('taker'),
    i128('takerOrderId'),
    u64('takerClientOrderId'),

    i64('price'),
    i64('quantity'),
  ]),
  'fill',
);
PerpEventLayout.addVariant(
  1,
  struct([
    sideLayout('side', 1),
    u8('slot'),
    seq(u8(), 5),
    publicKeyLayout('owner'),
    i64('quantity'),
  ]),
  'out',
);

export interface FillEvent {
  side: 'buy' | 'sell';
  makerSlot: number;
  makerOut: boolean;
  maker: PublicKey;
  makerOrderId: BN;
  makerClientOrderId: BN;
  bestInitial: BN;
  timestamp: BN;

  taker: PublicKey;
  takerOrderId: BN;
  takerClientOrderId: BN;

  price: BN;
  quantity: BN;
}

export interface OutEvent {
  side: 'buy' | 'sell';
  slot: number;
  owner: PublicKey;
  quantity: BN;
}

export const PerpEventQueueLayout = struct([
  metaDataLayout('metaData'),
  u64('head'),
  u64('count'),
  u64('seqNum'),
  I80F48Layout('makerFee'),
  I80F48Layout('takerFee'),
  seq(PerpEventLayout, greedy(PerpEventLayout.span), 'events'),
]);

export class PerpEventQueue {
  head!: BN;
  count!: BN;
  seqNum!: BN;
  makerFee!: I80F48;
  takerFee!: I80F48;
  events!: any[];

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }

  getUnconsumedEvents(): { fill?: FillEvent; out?: OutEvent }[] {
    const events: { fill?: FillEvent; out?: OutEvent }[] = [];
    const head = this.head.toNumber();
    for (let i = 0; i < this.count.toNumber(); i++) {
      events.push(this.events[(head + i) % this.events.length]);
    }
    return events;
  }

  eventsSince(lastSeqNum: BN): { fill?: FillEvent; out?: OutEvent }[] {
    // TODO doesn't work when lastSeqNum == 0; please fix

    const modulo64Uint = new BN('10000000000000000', 'hex');
    let missedEvents = this.seqNum
      .add(modulo64Uint)
      .sub(lastSeqNum)
      .mod(modulo64Uint);

    /*
    console.log({
      last: lastSeqNum.toString(),
      now: this.seqNum.toString(),
      missed: missedEvents.toString(),
      mod: modulo64Uint.toString(),
    });
    */

    const bufferLength = new BN(this.events.length);
    if (missedEvents.gte(bufferLength)) {
      missedEvents = bufferLength.sub(new BN(1));
    }

    const endIndex = this.head.add(this.count).mod(bufferLength);
    const startIndex = endIndex
      .add(bufferLength)
      .sub(missedEvents)
      .mod(bufferLength);

    /*
    console.log({
      bufLength: bufferLength.toString(),
      missed: missedEvents.toString(),
      head: this.head.toString(),
      count: this.count.toString(),
      end: endIndex.toString(),
      start: startIndex.toString(),
    });
    */

    const results: { fill?: FillEvent; out?: OutEvent }[] = [];
    let index = startIndex;
    while (!index.eq(endIndex)) {
      const event = this.events[index.toNumber()];
      if (event.fill || event.out) results.push(event);
      index = index.add(new BN(1)).mod(bufferLength);
    }

    return results;
  }
}

const BOOK_NODE_SIZE = 88;
const BOOK_NODE_LAYOUT = union(u32('tag'), blob(BOOK_NODE_SIZE - 4), 'node');
BOOK_NODE_LAYOUT.addVariant(0, struct([]), 'uninitialized');
BOOK_NODE_LAYOUT.addVariant(
  1,
  struct([
    // Only the first prefixLen high-order bits of key are meaningful
    u32('prefixLen'),
    u128('key'),
    seq(u32(), 2, 'children'),
  ]),
  'innerNode',
);
BOOK_NODE_LAYOUT.addVariant(
  2,
  struct([
    u8('ownerSlot'), // Index into OPEN_ORDERS_LAYOUT.orders
    blob(3),
    u128('key'), // (price, seqNum)
    publicKeyLayout('owner'), // Open orders account
    u64('quantity'), // In units of lot size
    u64('clientOrderId'),
    u64('bestInitial'),
    u64('timestamp'),
  ]),
  'leafNode',
);
BOOK_NODE_LAYOUT.addVariant(3, struct([u32('next')]), 'freeNode');
BOOK_NODE_LAYOUT.addVariant(4, struct([]), 'lastFreeNode');

export const BookSideLayout = struct([
  metaDataLayout('metaData'),
  nu64('bumpIndex'),
  nu64('freeListLen'),
  u32('freeListHead'),
  u32('rootNode'),
  nu64('leafCount'),
  seq(BOOK_NODE_LAYOUT, MAX_BOOK_NODES, 'nodes'),
]);

export class PriceCache {
  price!: I80F48;
  lastUpdate!: BN;

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }
}
export class PriceCacheLayout extends Structure {
  constructor(property) {
    super([I80F48Layout('price'), u64('lastUpdate')], property);
  }

  decode(b, offset) {
    return new PriceCache(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}
export function priceCacheLayout(property = '') {
  return new PriceCacheLayout(property);
}

export class RootBankCache {
  depositIndex!: I80F48;
  borrowIndex!: I80F48;
  lastUpdate!: BN;

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }
}
export class RootBankCacheLayout extends Structure {
  constructor(property) {
    super(
      [
        I80F48Layout('depositIndex'),
        I80F48Layout('borrowIndex'),
        u64('lastUpdate'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new RootBankCache(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}
export function rootBankCacheLayout(property = '') {
  return new RootBankCacheLayout(property);
}

export class PerpMarketCache {
  longFunding!: I80F48;
  shortFunding!: I80F48;
  lastUpdate!: BN;

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }
}
export class PerpMarketCacheLayout extends Structure {
  constructor(property) {
    super(
      [
        I80F48Layout('longFunding'),
        I80F48Layout('shortFunding'),
        u64('lastUpdate'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new PerpMarketCache(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}
export function perpMarketCacheLayout(property = '') {
  return new PerpMarketCacheLayout(property);
}

export const MangoCacheLayout = struct([
  metaDataLayout('metaData'),
  seq(priceCacheLayout(), MAX_PAIRS, 'priceCache'),
  seq(rootBankCacheLayout(), MAX_TOKENS, 'rootBankCache'),
  seq(perpMarketCacheLayout(), MAX_PAIRS, 'perpMarketCache'),
]);

export class MangoCache {
  publicKey: PublicKey;

  priceCache!: PriceCache[];
  rootBankCache!: RootBankCache[];
  perpMarketCache!: PerpMarketCache[];

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    Object.assign(this, decoded);
  }
}

export class NodeBank {
  publicKey: PublicKey;

  deposits!: I80F48;
  borrows!: I80F48;
  vault!: PublicKey;

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    Object.assign(this, decoded);
  }
}

export class EventQueueHeader {
  metaData!: MetaData;
  head!: number;
  count!: number;
  seqNum!: number;

  makerFee!: I80F48;
  takerFee!: I80F48;
  constructor(decoded: any) {
    Object.assign(this, decoded);
  }
}
export class EventQueueHeaderLayout extends Structure {
  constructor(property) {
    super(
      [
        metaDataLayout('metaData'),
        u64('head'),
        u64('count'),
        u64('seqNum'),
        I80F48Layout('makerFee'),
        I80F48Layout('takerFee'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new EventQueueHeader(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}
export function eventQueueHeaderLayout(property = '') {
  return new EventQueueHeaderLayout(property);
}

export enum EventType {
  Fill,
  Out,
}
export class AnyEvent {
  eventType!: EventType;
}
export class AnyEventLayout extends Structure {
  constructor(property) {
    super([u8('eventType'), seq(u8(), 7, 'padding')], property);
  }

  decode(b, offset) {
    return new EventQueueHeader(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}
export function anyEventLayout(property = '') {
  return new AnyEventLayout(property);
}

// TODO is this duplicated? look at PerpEventQueue above
export class EventQueue {
  metaData!: MetaData;
  head!: number;
  count!: number;
  seqNum!: number;
  makerFee!: I80F48;
  takerFee!: I80F48;
  buf!: AnyEvent[];

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }
}
export class EventQueueLayout extends Structure {
  constructor(property) {
    //const headerLayout = eventQueueHeaderLayout('header');
    const queueLength = u64('count');
    console.log(queueLength);
    super(
      [
        metaDataLayout('metaData'),
        u64('head'),
        queueLength,
        u64('seqNum'),
        I80F48Layout('makerFee'),
        I80F48Layout('takerFee'),
        seq(anyEventLayout(), offset(queueLength, -1), 'buf'),
      ],
      property,
    );
  }

  decode(b, offset) {
    return new EventQueue(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}
export function eventQueueLayout(property = '') {
  return new EventQueueLayout(property);
}
