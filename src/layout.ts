import {
  struct,
  u32,
  u8,
  u16,
  union,
  seq,
  Blob,
  Structure,
  Layout,
  UInt,
  blob,
  nu64,
} from 'buffer-layout';
import { AccountInfo, Connection, PublicKey } from '@solana/web3.js';
import { I80F48 } from './fixednum';
import BN from 'bn.js';
import { promiseUndef, zeroKey } from './utils';

export const MAX_TOKENS = 32;
export const MAX_PAIRS = MAX_TOKENS - 1;
export const MAX_NODE_BANKS = 8;

class _I80F48Layout extends Blob {
  constructor(property: string) {
    super(16, property);
  }

  decode(b, offset) {
    return new I80F48(new BN(super.decode(b, offset), 10, 'le'));
  }

  encode(src, b, offset) {
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
    if (this.signed) {
      return new BN(super.decode(b, offset), 10, 'le').toTwos(
        Math.pow(2, this['length']),
      );
    } else {
      return new BN(super.decode(b, offset), 10, 'le');
    }
  }

  encode(src, b, offset) {
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

export function sideLayout(property) {
  return new EnumLayout({ buy: 0, sell: 1 }, 4, property);
}

export function orderTypeLayout(property) {
  return new EnumLayout({ limit: 0, ioc: 1, postOnly: 2 }, 4, property);
}

export function selfTradeBehaviorLayout(property) {
  return new EnumLayout(
    { decrementTake: 0, cancelProvide: 1, abortTransaction: 2 },
    4,
    property,
  );
}

export const ACCOUNT_LAYOUT = struct([
  blob(32, 'mint'),
  blob(32, 'owner'),
  nu64('amount'),
  blob(93),
]);

/**
 * Need to implement layouts for each of the structs found in state.rs
 */
export const MerpsInstructionLayout = union(u32('instruction'));
MerpsInstructionLayout.addVariant(
  0,
  struct([u64('signerNonce'), u64('validInterval')]),
  'InitMerpsGroup',
);
MerpsInstructionLayout.addVariant(1, struct([]), 'InitMerpsAccount');
MerpsInstructionLayout.addVariant(2, struct([u64('quantity')]), 'Deposit');
MerpsInstructionLayout.addVariant(
  3,
  struct([u64('quantity'), u8('allowBorrow')]),
  'Withdraw',
);
MerpsInstructionLayout.addVariant(
  4,
  struct([u64('marketIndex'), u128('maintLeverage'), u128('initLeverage')]),
  'AddSpotMarket',
);
MerpsInstructionLayout.addVariant(
  5,
  struct([u64('marketIndex')]),
  'AddToBasket',
);
MerpsInstructionLayout.addVariant(6, struct([u64('quantity')]), 'Borrow');
MerpsInstructionLayout.addVariant(7, struct([]), 'CachePrices');
MerpsInstructionLayout.addVariant(8, struct([]), 'CacheRootBanks');
MerpsInstructionLayout.addVariant(
  9,
  struct([
    sideLayout('side'),
    u64('limitPrice'),
    u64('maxBaseQuantity'),
    u64('maxQuoteQuantity'),
    selfTradeBehaviorLayout('selfTradeBehavior'),
    orderTypeLayout('orderType'),
    u64('clientId'),
    u16('limit'),
  ]),
  'PlaceSpotOrder',
);
MerpsInstructionLayout.addVariant(10, struct([]), 'AddOracle');
MerpsInstructionLayout.addVariant(
  11,
  struct([
    u64('marketIndex'),
    I80F48Layout('maintLeverage'),
    I80F48Layout('initLeverage'),
    i64('baseLotSize'),
    i64('quoteLotSize'),
  ]),
  'AddPerpMarket',
);
MerpsInstructionLayout.addVariant(
  13,
  struct([u64('client_order_id')]),
  'CancelPerpOrderByClientId',
);
MerpsInstructionLayout.addVariant(
  14,
  struct([i128('order_id'), sideLayout('side')]),
  'CancelPerpOrder',
);
MerpsInstructionLayout.addVariant(15, struct([u64('limit')]), 'ConsumeEvents');
MerpsInstructionLayout.addVariant(16, struct([]), 'CachePerpMarkets');
MerpsInstructionLayout.addVariant(17, struct([]), 'UpdateFunding');
MerpsInstructionLayout.addVariant(
  18,
  struct([I80F48Layout('price')]),
  'SetOracle',
);
MerpsInstructionLayout.addVariant(19, struct([]), 'SettleFunds');
MerpsInstructionLayout.addVariant(21, struct([]), 'UpdateRootBank');

const instructionMaxSpan = Math.max(
  // @ts-ignore
  ...Object.values(MerpsInstructionLayout.registry).map((r) => r.span),
);
export function encodeMerpsInstruction(data) {
  const b = Buffer.alloc(instructionMaxSpan);
  const span = MerpsInstructionLayout.encode(data, b);
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
    if (this.basePosition.gt(new BN(0))) {
      return health.sub(
        longFunding
          .sub(this.longSettledFunding)
          .mul(I80F48.fromI64(this.basePosition)),
      );
    } else {
      return health.add(
        shortFunding
          .sub(this.shortSettledFunding)
          .mul(I80F48.fromI64(this.basePosition)),
      );
    }
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

export const MerpsGroupLayout = struct([
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
  publicKeyLayout('merpsCache'),
  u64('validInterval'),
]);

export const MerpsAccountLayout = struct([
  metaDataLayout('metaData'),
  publicKeyLayout('merpsGroup'),
  publicKeyLayout('owner'),
  seq(bool(), MAX_TOKENS, 'inBasket'),
  seq(I80F48Layout(), MAX_TOKENS, 'deposits'),
  seq(I80F48Layout(), MAX_TOKENS, 'borrows'),
  seq(publicKeyLayout(), MAX_PAIRS, 'spotOpenOrders'),
  seq(perpAccountLayout(), MAX_PAIRS, 'perpAccounts'),
]);

export const RootBankLayout = struct([
  metaDataLayout('metaData'),
  u64('numNodeBanks'), // usize?
  seq(publicKeyLayout(), MAX_NODE_BANKS, 'nodeBanks'),
  I80F48Layout('depositIndex'),
  I80F48Layout('borrowIndex'),
  u64('lastUpdated'),
]);

export const NodeBankLayout = struct([
  metaDataLayout('metaData'),
  I80F48Layout('deposits'),
  I80F48Layout('borrows'),
  publicKeyLayout('vault'),
]);

export const StubOracleLayout = struct([
  I80F48Layout('price'),
  u64('lastUpdate'),
]);

export const PerpMarketLayout = struct([
  metaDataLayout('metaData'),
  publicKeyLayout('merpsGroup'),
  publicKeyLayout('bids'),
  publicKeyLayout('asks'),
  publicKeyLayout('eventQueue'),

  I80F48Layout('longFunding'),
  I80F48Layout('shortFunding'),
  i64('openInterest'),
  i64('quoteLotSize'),
  publicKeyLayout('indexOracle'),
  u64('lastUpdated'),
  u64('seqNum'),
  i64('contractSize'),
]);

export class PerpMarket {
  publicKey: PublicKey;
  merpsGroup!: PublicKey;
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

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    Object.assign(this, decoded);
  }
}

export const PerpEventLayout = struct([
  u8('eventType'),
  seq(u8(), 87, 'padding'),
]);

export const PerpEventQueueLayout = struct([
  metaDataLayout('metaData'),
  u64('head'),
  u64('count'),
  u64('seqNum'),
]);

export const PerpBookSizeLayout = struct([
  metaDataLayout('metaData'),
  u64('bumpIndex'),
  u64('freeListLen'),
  u32('freeListHead'),
  u32('rootNode'),
  u64('leafCount'),
  seq(u8(), 72 * 1024, 'nodes'),
]);

export class PriceCache {
  price!: I80F48;
  lastUpdate!: BN;
  isInitialized!: boolean;

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

export const MerpsCacheLayout = struct([
  metaDataLayout('metaData'),
  seq(priceCacheLayout(), MAX_PAIRS, 'priceCache'),
  seq(rootBankCacheLayout(), MAX_TOKENS, 'rootBankCache'),
  seq(perpMarketCacheLayout(), MAX_PAIRS, 'perpMarketCache'),
]);

export class MerpsCache {
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

export class RootBank {
  publicKey: PublicKey;

  numNodeBanks!: number;
  nodeBanks!: PublicKey[];
  depositIndex!: I80F48;
  borrowIndex!: I80F48;
  lastUpdated!: BN;

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    Object.assign(this, decoded);
  }

  async loadNodeBanks(connection: Connection): Promise<NodeBank[]> {
    const promises: Promise<AccountInfo<Buffer> | undefined | null>[] = [];

    for (let i = 0; i < this.nodeBanks.length; i++) {
      if (this.nodeBanks[i].equals(zeroKey)) {
        promises.push(promiseUndef());
      } else {
        promises.push(connection.getAccountInfo(this.nodeBanks[i]));
      }
    }

    const accounts = await Promise.all(promises);

    return accounts
      .filter((acc) => acc && acc.data)
      .map((acc, i) => {
        const decoded = NodeBankLayout.decode(acc?.data);
        return new NodeBank(this.nodeBanks[i], decoded);
      });
  }
}
