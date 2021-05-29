import { struct, u32, u8, union, seq, Blob, Structure } from 'buffer-layout';
import { PublicKey } from '@solana/web3.js';
import { I80F48 } from './fixednum';
import BN from 'bn.js';
import { toBigIntLE, toBufferLE } from 'bigint-buffer';

export const MAX_TOKENS = 32;
export const MAX_PAIRS = MAX_TOKENS - 1;
export const MAX_NODE_BANKS =  8;

class _I80F48Layout extends Blob {
  constructor(property: string) {
    super(16, property)
  }

  decode(b, offset) {
    return new I80F48(new BN(super.decode(b, offset), 10, 'le'))
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
    Object.setPrototypeOf(this, new.target.prototype)
  }

  decode(b, offset) {
    return new BN(super.decode(b, offset), 10, 'le');
  }

  encode(src, b, offset) {
    return super.encode(src.toArrayLike(Buffer, 'le', this['span']), b, offset);
  }
}

class U64Layout extends Blob {
  constructor(property) {
    super(8, property);
    // restore prototype chain
    Object.setPrototypeOf(this, new.target.prototype)
  }

  decode(b, offset) {
    return toBigIntLE(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(toBufferLE(src, 8), b, offset);
  }
}

export function u64(property = '') {
  return new BNLayout(8, property);
}

/**
 * Need to implement layouts for each of the structs found in state.rs
 */
export const MerpsInstructionLayout = union(u32('instruction'))
MerpsInstructionLayout.addVariant(0, struct([u64('signerNonce'), u8('validInterval')]), 'InitMerpsGroup')
MerpsInstructionLayout.addVariant(1, struct([u8('index')]), 'TestMultiTx')
// @ts-ignore
const instructionMaxSpan = Math.max(...Object.values(MerpsInstructionLayout.registry).map((r) => r.span));
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
    super([
      u8('dataType'),
      u8('version'),
      u8('isInitialized'),
      seq(u8(), 5, 'padding')
    ], property)
  }
  
  decode(b, offset) {
    return new MetaData(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }

};
export function metaDataLayout(property = '') {
  return new MetaDataLayout(property);
}

export const MerpsGroupLayout = struct([
  metaDataLayout('metaData'),
  u8('numTokens'), //usize?
  u8('numMarkets'), //usize?
  seq(publicKeyLayout(), MAX_TOKENS, 'tokens'),
  seq(publicKeyLayout(), MAX_PAIRS, 'oracles'),
  seq(publicKeyLayout(), MAX_PAIRS, 'spotMarkets'),
  seq(publicKeyLayout(), MAX_PAIRS, 'perpMarkets'),
  seq(publicKeyLayout(), MAX_TOKENS, 'rootBanks'),
  seq(I80F48Layout(), MAX_TOKENS, 'assetWeights'),
  u64('signerNonce'),
  publicKeyLayout('signerKey'),
  publicKeyLayout('admin'),
  publicKeyLayout('dexProgramId'),
  publicKeyLayout('merpsCache'),
  u8('validInterval'),
  seq(u8(), 21, 'padding') // padding required for alignment
]);

export const RootBankLayout = struct([
  metaDataLayout('metaData'),
  u8('numNodeBanks'), // usize?
  seq(publicKeyLayout(), MAX_NODE_BANKS, 'nodeBanks'),
  I80F48Layout('depositIndex'),
  I80F48Layout('borrowIndex'),
  u64('lastUpdated'),
  seq(u8(), 7, 'padding'),
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
    super([
      I80F48Layout('price'),
      u64('lastUpdate'),
    ], property)
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
    super([
      I80F48Layout('depositIndex'),
      I80F48Layout('borrowIndex'),
      u64('lastUpdate'),
    ], property)
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
  fundingEarned!: I80F48;
  lastUpdate!: BN;
 
  constructor(decoded: any) {
    Object.assign(this, decoded);
  }
}
export class PerpMarketCacheLayout extends Structure {
  constructor(property) {
    super([
      I80F48Layout('fundingEarned'),
      u64('lastUpdate'),
    ], property)
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
])
