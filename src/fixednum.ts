import BN from 'bn.js';
import Big from 'big.js';

// TODO - this whole class is inefficient; consider optimizing
export class I80F48 {
  /**
  This is represented by a 128 bit signed integer underneath
  The first 80 bits are treated as an integer and last 48 bits are treated as fractional part after binary point
  It's possible to think of an I80F48 as an i128 divided by 2 ^ 40

  Read up on how fixed point math works: https://inst.eecs.berkeley.edu/~cs61c/sp06/handout/fixedpt.html
  Read up on how 2s complement works: https://en.wikipedia.org/wiki/Two%27s_complement
   */
  static MAX_SIZE = 128;
  static FRACTIONS = 48;

  data: BN; // This is i128 => array of 16 bytes
  maxValue: BN;
  minValue: BN;
  binaryLayout: string;

  constructor(data: BN) {
    // TODO why is this calculated here? should just be static part of the class
    this.maxValue = new BN(2)
      .pow(new BN(I80F48.MAX_SIZE))
      .div(new BN(2))
      .sub(new BN(1));
    this.minValue = new BN(2).pow(new BN(I80F48.MAX_SIZE)).div(new BN(2)).neg();
    if (data.lt(this.minValue) || data.gt(this.maxValue)) {
      throw new Error('Number out of range');
    }

    this.data = data;
    this.binaryLayout = data
      .toTwos(I80F48.MAX_SIZE)
      .toString(2, I80F48.MAX_SIZE)
      .replace(/-/g, '');
  }
  static fromNumber(x: number): I80F48 {
    return this.fromString(x.toString());
  }
  static fromString(x: string): I80F48 {
    const multiplier = new Big(2).pow(this.FRACTIONS);
    const initialValue = new Big(x).times(multiplier);
    const fixedPointValue = new BN(initialValue.round().toFixed());
    return new I80F48(fixedPointValue);
  }
  static fromI64(x: BN): I80F48 {
    return this.fromString(x.toString());
  }
  static fromU64(x: BN): I80F48 {
    return this.fromString(x.toString());
  }
  toString(): string {
    return this.toFixed();
  }
  toFixed(decimals?: number): string {
    return this.toBig().toFixed(decimals);
  }
  toBig(): Big {
    const divider = new Big(2).pow(I80F48.FRACTIONS);
    return new Big(this.data.toString()).div(divider);
  }
  toNumber(): number {
    return this.toBig().toNumber();
  }
  static fromArray(src: Uint8Array): I80F48 {
    if (src.length !== 16) {
      throw new Error('Uint8Array must be of length 16');
    }
    return new I80F48(new BN(src, 'le').fromTwos(I80F48.MAX_SIZE));
  }
  toArray(): Uint8Array {
    return new Uint8Array(this.data.toTwos(I80F48.MAX_SIZE).toArray('le', 16));
  }
  toArrayLike(
    ArrayType: typeof Buffer,
    endian?: BN.Endianness,
    length?: number,
  ): Buffer {
    return this.data
      .toTwos(I80F48.MAX_SIZE)
      .toArrayLike(ArrayType, endian, length);
  }
  getInternalValue(): BN {
    return this.data;
  }
  getBinaryLayout(): string {
    return this.binaryLayout;
  }
  add(x: I80F48): I80F48 {
    return new I80F48(this.data.add(x.getInternalValue()));
  }
  sub(x: I80F48): I80F48 {
    return new I80F48(this.data.sub(x.getInternalValue()));
  }

  /**
   * Multiply the two and shift
   * @param x
   */
  mul(x: I80F48): I80F48 {
    const divider = new Big(2).pow(I80F48.FRACTIONS);
    const result = new Big(this.data.mul(x.getInternalValue()).toString())
      .div(divider)
      .round()
      .toFixed();
    return new I80F48(new BN(result));
  }

  div(x: I80F48): I80F48 {
    const multiplier = new Big(2).pow(I80F48.FRACTIONS);
    const result = new Big(this.data.toString())
      .div(x.getInternalValue().toString())
      .times(multiplier)
      .round()
      .toFixed();
    return new I80F48(new BN(result));
  }

  gt(x: I80F48): boolean {
    return this.data.gt(x.getInternalValue());
  }
  lt(x: I80F48): boolean {
    return this.data.lt(x.getInternalValue());
  }
  gte(x: I80F48): boolean {
    return this.data.gte(x.getInternalValue());
  }
  lte(x: I80F48): boolean {
    return this.data.lte(x.getInternalValue());
  }
  eq(x: I80F48): boolean {
    // TODO make sure this works when they're diff signs or 0
    return this.data.eq(x.getInternalValue());
  }
  cmp(x: I80F48): -1 | 0 | 1 {
    // TODO make sure this works when they're diff signs or 0
    return this.data.cmp(x.getInternalValue());
  }
  neg(): I80F48 {
    return this.mul(NEG_ONE_I80F48);
  }
  isNeg(): boolean {
    return this.data.isNeg();
  }
}

export const ONE_I80F48 = I80F48.fromString('1');
export const ZERO_I80F48 = I80F48.fromString('0');
export const NEG_ONE_I80F48 = I80F48.fromString('-1');
