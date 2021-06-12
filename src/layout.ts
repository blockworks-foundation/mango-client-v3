import {
  struct,
  u32,
  u8,
  union,
  seq,
  Blob,
  Structure,
  Layout,
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
  constructor(number: number, property) {
    super(number, property);
    // restore prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }

  decode(b, offset) {
    return new BN(super.decode(b, offset), 10, 'le');
  }

  encode(src, b, offset) {
    return super.encode(src.toArrayLike(Buffer, 'le', this['span']), b, offset);
  }
}

export function u64(property = '') {
  return new BNLayout(8, property);
}

export function i64(property = '') {
  return new BNLayout(8, property);
}

export function u128(property?: string) {
  return new BNLayout(16, property);
}

export function i128(property?: string) {
  return new BNLayout(16, property);
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

/**
 * Need to implement layouts for each of the structs found in state.rs
 */
export const MerpsInstructionLayout = union(u32('instruction'));
MerpsInstructionLayout.addVariant(
  0,
  struct([u64('signerNonce'), u8('validInterval')]),
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
  struct([
    u64('marketIndex'),
    u128('maintAssetWeight'),
    u128('initAssetWeight'),
  ]),
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
MerpsInstructionLayout.addVariant(9, struct([]), 'PlaceSpotOrder');
MerpsInstructionLayout.addVariant(10, struct([]), 'AddOracle');

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
  spotMarket!: PublicKey;
  maintAssetWeight!: I80F48;
  initAssetWeight!: I80F48;
  maintLiabWeight!: I80F48;
  initLiabWeight!: I80F48;
  baseLotSize!: BN;
  quoteLotSize!: BN;

  constructor(decoded: any) {
    Object.assign(this, decoded);
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
  totalBase!: BN;
  totalQuote!: BN;
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
        i64('totalBase'),
        i64('totalQuote'),
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
  u8('validInterval'),
  seq(u8(), 7, 'padding'), // padding required for alignment
]);

export const MerpsAccountLayout = struct([
  metaDataLayout('metaData'),
  publicKeyLayout('merpsGroups'),
  publicKeyLayout('owner'),
  seq(bool(), MAX_PAIRS, 'inBasket'),
  seq(I80F48Layout(), MAX_TOKENS, 'deposits'),
  seq(I80F48Layout(), MAX_TOKENS, 'borrows'),
  seq(publicKeyLayout(), MAX_PAIRS, 'spotOpenOrders'),
  seq(perpAccountLayout(), MAX_PAIRS, 'perpAccounts'),

  seq(u8(), 1, 'padding'),
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

  async loadNodeBanks(
    connection: Connection,
  ): Promise<(NodeBank | undefined)[]> {
    const promises: Promise<AccountInfo<Buffer> | undefined | null>[] = [];

    for (let i = 0; i < this.nodeBanks.length; i++) {
      if (this.nodeBanks[i].equals(zeroKey)) {
        promises.push(promiseUndef());
      } else {
        promises.push(connection.getAccountInfo(this.nodeBanks[i]));
      }
    }

    const accounts = await Promise.all(promises);

    return accounts.map((acc, i) => {
      if (acc && acc.data) {
        const decoded = NodeBankLayout.decode(acc.data);
        return new NodeBank(this.nodeBanks[i], decoded);
      }
      return undefined;
    });
  }
}
