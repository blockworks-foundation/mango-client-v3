import BN from 'bn.js';


export class I80F48 {
  /**
  This is represented by a 128 bit signed integer underneath
  The first 80 bits are treated as an integer and last 48 bits are treated as fractional part after binary point
  It's possible to think of an I80F48 as an i128 divided by 2 ^ 40

  Read up on how fixed point math works: https://inst.eecs.berkeley.edu/~cs61c/sp06/handout/fixedpt.html
  Read up on how 2s complement works: https://en.wikipedia.org/wiki/Two%27s_complement
   */

  data: BN;  // This is i128 => array of 16 bytes

  constructor(data: BN) {
    this.data = data;
  }

  static fromFloat(x: number): I80F48 {
    throw new Error("Not Implemented")
  }

  toFloat(): number {
    throw new Error("Not Implemented")
  }

  toString(): string {
    throw new Error("Not Implemented")
  }


  /**
   * This is mostly for encoding into the transaction
   * Probably can just return the array underneath the data BN
   */
  toArray(): Uint8Array {
    throw new Error("Not Implemented")
  }

  static fromArray(src: Uint8Array): I80F48 {
    throw new Error("Not Implemented")
  }

  add(x: I80F48): I80F48 {
    throw new Error("Not Implemented")
  }

  sub(x: I80F48): I80F48 {
    throw new Error("Not Implemented")
  }

  /**
   * Multiply the two and shift
   * @param x
   */
  mul(x: I80F48): I80F48 {
    throw new Error("Not Implemented")
  }

  div(x: I80F48): I80F48 {
    throw new Error("Not Implemented")
  }

}