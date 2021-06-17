import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { DataType, PerpMarket } from './layout';
import { I80F48 } from './fixednum';

// All LeafNodes are orders stored on the book
export type LeafNode = {
  ownerSlot: number;
  key: BN;
  owner: PublicKey;
  quantity: BN;
  clientOrderId: BN;
};

// TODO - maybe store ref inside PerpMarket class
export class BookSide {
  publicKey: PublicKey;
  isBids: boolean;
  perpMarket: PerpMarket;

  bumpIndex!: number;
  freeListLen!: number;
  freelistHead!: number;
  rootNode!: number;
  leafCount!: number;
  nodes!: any[]; // This is either AnyNode, FreeNode, InnerNode...

  constructor(publicKey: PublicKey, perpMarket: PerpMarket, decoded: any) {
    this.publicKey = publicKey;
    this.isBids = decoded.metaData.dataType === DataType.Bids;
    this.perpMarket = perpMarket;
    Object.assign(this, decoded);
  }

  *items(): Generator<LeafNode> {
    if (this.leafCount === 0) {
      return;
    }
    const stack = [this.rootNode];
    while (stack.length > 0) {
      const index = stack.pop();

      // @ts-ignore
      const { leafNode, innerNode } = this.nodes[index]; // we know index is undefined

      if (leafNode) {
        yield leafNode;
      } else if (innerNode) {
        if (this.isBids) {
          stack.push(innerNode.children[0], innerNode.children[1]);
        } else {
          stack.push(innerNode.children[1], innerNode.children[0]);
        }
      }
    }
  }

  [Symbol.iterator]() {
    return this.items();
  }

  getL2(depth: number): [I80F48, I80F48, BN, BN][] {
    const levels: [BN, BN][] = []; // (price, size)
    //@ts-ignore
    for (const { key, quantity } of this.items()) {
      const price = getPriceFromKey(key);
      if (levels.length > 0 && levels[levels.length - 1][0].eq(price)) {
        levels[levels.length - 1][1].iadd(quantity);
      } else if (levels.length === depth) {
        break;
      } else {
        levels.push([price, quantity]);
      }
    }
    return levels.map(([priceLots, sizeLots]) => [
      this.perpMarket.priceLotsToNative(priceLots),
      this.perpMarket.baseLotsToNative(sizeLots),
      priceLots,
      sizeLots,
    ]);
  }
}

function getPriceFromKey(key: BN) {
  return key.ushrn(64); // TODO - maybe use shrn instead
}
