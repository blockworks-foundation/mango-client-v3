import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { DataType } from './layout';
import PerpMarket from './PerpMarket';
import { ZERO_BN } from './utils';

export interface PerpOrder {
  orderId: BN;
  owner: PublicKey;
  openOrdersSlot: number;
  price: number;
  priceLots: BN;
  size: number;
  feeTier: number;
  sizeLots: BN;
  side: 'buy' | 'sell';
  clientId?: BN;
  bestInitial: BN;
  timestamp: BN;
}

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

  *items(): Generator<PerpOrder> {
    if (this.leafCount === 0) {
      return;
    }
    const stack = [this.rootNode];
    while (stack.length > 0) {
      const index = stack.pop();

      // @ts-ignore
      const { leafNode, innerNode } = this.nodes[index]; // we know index is undefined

      if (leafNode) {
        const price = getPriceFromKey(leafNode.key);
        yield {
          orderId: leafNode.key,
          clientId: leafNode.clientOrderId,
          owner: leafNode.owner,
          openOrdersSlot: leafNode.ownerSlot,
          feeTier: 0,
          price: this.perpMarket.priceLotsToNumber(price),
          priceLots: price,
          size: this.perpMarket.baseLotsToNumber(leafNode.quantity),
          sizeLots: leafNode.quantity,
          side: (this.isBids ? 'buy' : 'sell') as 'buy' | 'sell',
          bestInitial: leafNode.bestInitial,
          timestamp: leafNode.timestamp,
        };
      } else if (innerNode) {
        if (this.isBids) {
          stack.push(innerNode.children[0], innerNode.children[1]);
        } else {
          stack.push(innerNode.children[1], innerNode.children[0]);
        }
      }
    }
  }

  /**
   * Return the ui price reached at `quantity` lots up the book;
   * return undefined if `quantity` not on book
   */
  getImpactPriceUi(quantity: BN): number | undefined {
    const s = ZERO_BN.clone();
    for (const order of this) {
      s.iadd(order.sizeLots);
      if (s.gte(quantity)) {
        return order.price;
      }
    }
    return undefined;
  }
  getBest(): PerpOrder | undefined {
    if (this.leafCount === 0) {
      return;
    }
    let currNodeIndex = this.rootNode;
    const left = this.isBids ? 1 : 0;
    const side = this.isBids ? 'buy' : ('sell' as 'buy' | 'sell');
    while (currNodeIndex !== undefined) {
      const { leafNode, innerNode } = this.nodes[currNodeIndex]; // we know index is not undefined

      if (leafNode) {
        const price = getPriceFromKey(leafNode.key);

        return {
          orderId: leafNode.key,
          clientId: leafNode.clientOrderId,
          owner: leafNode.owner,
          openOrdersSlot: leafNode.ownerSlot,
          feeTier: 0,
          price: this.perpMarket.priceLotsToNumber(price),
          priceLots: price,
          size: this.perpMarket.baseLotsToNumber(leafNode.quantity),
          sizeLots: leafNode.quantity,
          side,
          bestInitial: leafNode.bestInitial,
          timestamp: leafNode.timestamp,
        };
      } else if (innerNode) {
        currNodeIndex = innerNode.children[left];
      }
    }
  }
  [Symbol.iterator]() {
    return this.items();
  }

  getL2(depth: number): [number, number, BN, BN][] {
    const levels: [BN, BN][] = []; // (price, size)
    //@ts-ignore
    for (const { priceLots, sizeLots } of this.items()) {
      if (levels.length > 0 && levels[levels.length - 1][0].eq(priceLots)) {
        levels[levels.length - 1][1].iadd(sizeLots);
      } else if (levels.length === depth) {
        break;
      } else {
        levels.push([priceLots, sizeLots]);
      }
    }
    return levels.map(([priceLots, sizeLots]) => [
      this.perpMarket.priceLotsToNumber(priceLots),
      this.perpMarket.baseLotsToNumber(sizeLots),
      priceLots,
      sizeLots,
    ]);
  }
}

export function getPriceFromKey(key: BN) {
  return key.ushrn(64); // TODO - maybe use shrn instead
}
