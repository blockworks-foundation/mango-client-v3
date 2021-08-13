import BN from 'bn.js';
import {
  FillEvent,
  LiquidateEvent,
  PerpMarketCache,
  PerpMarketInfo,
  PerpOpenOrders,
  ZERO_BN,
} from '.';
import { I80F48, ZERO_I80F48 } from './fixednum';
import PerpMarket from './PerpMarket';
import MangoAccount from './MangoAccount';
import MangoGroup from './MangoGroup';

export default class PerpAccount {
  basePosition!: BN;
  quotePosition!: I80F48;
  longSettledFunding!: I80F48;
  shortSettledFunding!: I80F48;
  openOrders!: PerpOpenOrders;
  mngoAccrued!: BN;

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }

  /**
   * Get average entry price of current position. Returned value is UI number.
   * Does not include fees.
   * Events are sorted latest event first
   */
  getAverageOpenPrice(
    mangoAccount: MangoAccount, // circular import?
    perpMarket: PerpMarket,
    events: any[], // TODO - replace with actual Event types coming from DB
  ): number {
    if (this.basePosition.isZero()) {
      return 0;
    }
    const basePos = perpMarket.baseLotsToNumber(this.basePosition);
    const userPk = mangoAccount.publicKey.toString();

    let currBase = basePos;
    let openingQuote = 0;

    for (const event of events) {
      let price, baseChange;
      if ('liqor' in event) {
        const le = event;
        price = le.price;
        let quantity = le.quantity;

        if (userPk == le.liqee) {
          quantity = -quantity;
        }

        if (currBase > 0 && quantity > 0) {
          // liquidation that opens
          baseChange = Math.min(currBase, quantity);
        } else if (currBase < 0 && quantity < 0) {
          // liquidation that opens
          baseChange = Math.max(currBase, quantity);
        } else {
          // liquidation that closes
          continue;
        }
      } else {
        const fe = event;
        // TODO - verify this gives proper UI number
        price = fe.price;
        let quantity = fe.quantity;

        if (
          (userPk == fe.taker && fe.takerSide === 'sell') ||
          (userPk == fe.maker && fe.takerSide === 'buy')
        ) {
          quantity = -quantity;
        }

        if (currBase > 0 && quantity > 0) {
          // Means we are opening long
          baseChange = Math.min(currBase, quantity);
        } else if (currBase < 0 && quantity < 0) {
          // means we are opening short
          baseChange = Math.max(currBase, quantity);
        } else {
          // ignore closing trades
          continue;
        }
      }

      openingQuote -= baseChange * price;
      currBase -= baseChange;
      if (currBase === 0) {
        return Math.abs(openingQuote) / basePos;
      }
    }

    // If we haven't returned yet, there was an error or missing data
    // TODO - consider failing silently
    throw new Error('Trade history incomplete');
  }

  /**
   * Get price at which you break even. Includes fees.
   */
  getBreakEvenPrice(
    mangoAccount: MangoAccount, // circular import?
    perpMarket: PerpMarket,
    events: any[], // TODO - replace with actual Event types coming from DB
  ) {
    if (this.basePosition.isZero()) {
      return 0;
    }
    const basePos = perpMarket.baseLotsToNumber(this.basePosition);
    const userPk = mangoAccount.publicKey.toString();

    let currBase = basePos;
    let totalQuoteChange = 0;

    for (const event of events) {
      let price, baseChange;
      if ('liqor' in event) {
        // TODO - build cleaner way to distinguish events
        const le = event;
        price = le.price;
        let quantity = le.quantity;

        if (userPk == le.liqee) {
          quantity = -quantity;
        }

        if (currBase > 0 && quantity > 0) {
          // liquidation that opens
          baseChange = Math.min(currBase, quantity);
        } else if (currBase < 0 && quantity < 0) {
          // liquidation that opens
          baseChange = Math.max(currBase, quantity);
        } else {
          // liquidation that closes
          baseChange = quantity;
        }
      } else {
        const fe = event;
        // TODO - verify this gives proper UI number
        price = fe.price;
        let quantity = fe.quantity;

        if (
          (userPk == fe.taker && fe.takerSide === 'sell') ||
          (userPk == fe.maker && fe.takerSide === 'buy')
        ) {
          quantity = -quantity;
        }

        if (currBase > 0 && quantity > 0) {
          // Means we are opening long
          baseChange = Math.min(currBase, quantity);
        } else if (currBase < 0 && quantity < 0) {
          // means we are opening short
          baseChange = Math.max(currBase, quantity);
        } else {
          baseChange = quantity;
        }
      }

      totalQuoteChange -= baseChange * price;
      currBase -= baseChange;

      if (currBase === 0) {
        return -totalQuoteChange / basePos;
      }
    }

    // If we haven't returned yet, there was an error or missing data
    // TODO - consider failing silently
    throw new Error('Trade history incomplete');
  }
  getPnl(perpMarketInfo: PerpMarketInfo, price: I80F48): I80F48 {
    return I80F48.fromI64(this.basePosition.mul(perpMarketInfo.baseLotSize))
      .mul(price)
      .add(this.quotePosition);
  }

  getUnsettledFunding(perpMarketCache: PerpMarketCache): I80F48 {
    if (this.basePosition.isNeg()) {
      return I80F48.fromI64(this.basePosition).mul(
        perpMarketCache.shortFunding.sub(this.shortSettledFunding),
      );
    } else {
      return I80F48.fromI64(this.basePosition).mul(
        perpMarketCache.longFunding.sub(this.longSettledFunding),
      );
    }
  }

  /**
   * Return the quote position after adjusting for unsettled funding
   */
  getQuotePosition(perpMarketCache: PerpMarketCache): I80F48 {
    return this.quotePosition.sub(this.getUnsettledFunding(perpMarketCache));
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
    if (newBase.gt(ZERO_BN)) {
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
    if (this.basePosition.gt(ZERO_BN)) {
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

  getLiabsVal(
    perpMarketInfo: PerpMarketInfo,
    price: I80F48,
    shortFunding: I80F48,
    longFunding: I80F48,
  ): I80F48 {
    let liabsVal = ZERO_I80F48;
    if (this.basePosition.lt(ZERO_BN)) {
      liabsVal = liabsVal.add(
        I80F48.fromI64(this.basePosition.mul(perpMarketInfo.baseLotSize)).mul(
          price,
        ),
      );
    }

    let realQuotePosition = this.quotePosition;
    if (this.basePosition.gt(ZERO_BN)) {
      realQuotePosition = this.quotePosition.sub(
        longFunding
          .sub(this.longSettledFunding)
          .mul(I80F48.fromI64(this.basePosition)),
      );
    } else if (this.basePosition.lt(ZERO_BN)) {
      realQuotePosition = this.quotePosition.sub(
        shortFunding
          .sub(this.shortSettledFunding)
          .mul(I80F48.fromI64(this.basePosition)),
      );
    }

    if (realQuotePosition.lt(ZERO_I80F48)) {
      liabsVal = liabsVal.add(realQuotePosition);
    }
    return liabsVal.neg();
  }
}
