import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { DataType } from './layout';
import PerpMarket from './PerpMarket';
import { U64_MAX_BN, ZERO_BN } from './utils/utils';
import { getUnixTs } from './client';

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
  expiryTimestamp: BN;
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

  includeExpired: boolean;
  now: BN; // this is the max timestamp on the book
  constructor(
    publicKey: PublicKey,
    perpMarket: PerpMarket,
    decoded: any,
    includeExpired = false,
  ) {
    this.publicKey = publicKey;
    this.isBids = decoded.metaData.dataType === DataType.Bids;
    this.perpMarket = perpMarket;
    this.includeExpired = includeExpired;
    Object.assign(this, decoded);

    // Determine the maxTimestamp found on the book to use for tif
    let maxTimestamp = new BN(getUnixTs() - 10);
    for (const { leafNode } of this.nodes) {
      if (leafNode && leafNode.timestamp.gt(maxTimestamp)) {
        maxTimestamp = leafNode.timestamp;
      }
    }
    this.now = maxTimestamp;
  }

  *items(): Generator<PerpOrder> {
    if (this.leafCount === 0) {
      return;
    }
    const now = this.now;
    const stack = [this.rootNode];
    const [left, right] = this.isBids ? [1, 0] : [0, 1];
    const side = (this.isBids ? 'buy' : 'sell') as 'buy' | 'sell';

    while (stack.length > 0) {
      const index = stack.pop();

      // @ts-ignore
      const { leafNode, innerNode } = this.nodes[index]; // we know index is not undefined

      if (leafNode) {
        const price = getPriceFromKey(leafNode.key);
        const expiryTimestamp = leafNode.timeInForce
          ? leafNode.timestamp.add(new BN(leafNode.timeInForce))
          : U64_MAX_BN;
        if (now.lt(expiryTimestamp) || this.includeExpired) {
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
            side,
            bestInitial: leafNode.bestInitial,
            timestamp: leafNode.timestamp,
            expiryTimestamp,
          };
        }
      } else if (innerNode) {
        stack.push(innerNode.children[right], innerNode.children[left]);
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
    const [left, right] = this.isBids ? [1, 0] : [0, 1];
    const side = (this.isBids ? 'buy' : 'sell') as 'buy' | 'sell';
    const stack = [this.rootNode];
    const now = this.now;

    while (stack.length > 0) {
      let index = stack.pop();

      // @ts-ignore
      const { leafNode, innerNode } = this.nodes[index]; // we know index is not undefined
      if (leafNode) {
        const price = getPriceFromKey(leafNode.key);

        const expiryTimestamp = leafNode.timeInForce
          ? leafNode.timestamp.add(new BN(leafNode.timeInForce))
          : U64_MAX_BN;

        if (now.lt(expiryTimestamp) || this.includeExpired) {
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
            expiryTimestamp,
          };
        }
      } else if (innerNode) {
        stack.push(innerNode.children[right], innerNode.children[left]);
      }
    }
  }
  [Symbol.iterator]() {
    return this.items();
  }

  getL2Ui(depth: number): [number, number][] {
    const levels: [number, number][] = []; // (price, size)
    //@ts-ignore
    for (const { price, size } of this.items()) {
      if (levels.length > 0 && levels[levels.length - 1][0] === price) {
        levels[levels.length - 1][1] += size;
      } else if (levels.length === depth) {
        break;
      } else {
        levels.push([price, size]);
      }
    }
    return levels;
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
