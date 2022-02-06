import BN from 'bn.js';
import { PerpMarketCache, PerpMarketInfo, ZERO_BN } from '.';
import { I80F48, ZERO_I80F48 } from './utils/fixednum';
import PerpMarket from './PerpMarket';
import MangoAccount from './MangoAccount';
import Big from 'big.js';

const ZERO = new Big(0);
const NEG_ONE = new Big(-1);

export default class PerpAccount {
  basePosition!: BN;
  quotePosition!: I80F48;
  longSettledFunding!: I80F48;
  shortSettledFunding!: I80F48;
  bidsQuantity!: BN;
  asksQuantity!: BN;
  takerBase!: BN;
  takerQuote!: BN;
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
  ): Big {
    if (this.basePosition.isZero()) {
      return ZERO;
    }
    const basePos = perpMarket.baseLotsToNumber(this.basePosition);
    const userPk = mangoAccount.publicKey.toString();

    let currBase = new Big(basePos);
    let openingQuote = ZERO;

    for (const event of events) {
      let price, baseChange;
      if ('liqor' in event) {
        const le = event;
        price = new Big(le.price);
        let quantity = new Big(le.quantity);

        if (userPk === le.liqee.toString()) {
          quantity = quantity.mul(NEG_ONE);
        }

        if (currBase.gt(ZERO) && quantity.gt(ZERO)) {
          // liquidation that opens
          baseChange = quantity.lt(currBase) ? quantity : currBase; // get min value
        } else if (currBase.lt(ZERO) && quantity.lt(ZERO)) {
          // liquidation that opens
          baseChange = currBase.gt(quantity) ? currBase : quantity; // get max value
        } else {
          // liquidation that closes
          continue;
        }
      } else {
        const fe = event;
        // TODO - verify this gives proper UI number
        price = new Big(fe.price);
        let quantity = new Big(fe.quantity);

        if (
          (userPk === fe.taker.toString() && fe.takerSide === 'sell') ||
          (userPk === fe.maker.toString() && fe.takerSide === 'buy')
        ) {
          quantity = quantity.mul(NEG_ONE);
        }

        if (currBase.gt(ZERO) && quantity.gt(ZERO)) {
          // Means we are opening long
          baseChange = quantity.lt(currBase) ? quantity : currBase; // get min value
        } else if (currBase.lt(ZERO) && quantity.lt(ZERO)) {
          // means we are opening short
          baseChange = currBase.gt(quantity) ? currBase : quantity; // get max value
        } else {
          // ignore closing trades
          continue;
        }
      }

      openingQuote = openingQuote.sub(baseChange.mul(price));
      currBase = currBase.sub(baseChange);
      if (currBase.eq(ZERO)) {
        return openingQuote.div(basePos).abs();
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
  ): Big {
    if (this.basePosition.isZero()) {
      return ZERO;
    }
    const basePos = perpMarket.baseLotsToNumber(this.basePosition);
    const userPk = mangoAccount.publicKey.toString();

    let currBase = new Big(basePos);
    let totalQuoteChange = ZERO;
    for (const event of events) {
      let price, baseChange;
      if ('liqor' in event) {
        // TODO - build cleaner way to distinguish events
        const le = event;
        price = new Big(le.price);
        let quantity = new Big(le.quantity);

        if (userPk === le.liqee.toString()) {
          quantity = quantity.mul(NEG_ONE);
        }

        if (currBase.gt(ZERO) && quantity.gt(ZERO)) {
          // liquidation that opens
          baseChange = quantity.lt(currBase) ? quantity : currBase; // get min value
        } else if (currBase.lt(ZERO) && quantity.lt(ZERO)) {
          // liquidation that opens
          baseChange = currBase.gt(quantity) ? currBase : quantity; // get max value
        } else {
          // liquidation that closes
          baseChange = quantity;
        }
      } else {
        const fe = event;
        // TODO - verify this gives proper UI number
        price = new Big(fe.price);
        let quantity = new Big(fe.quantity);

        if (
          (userPk === fe.taker.toString() && fe.takerSide === 'sell') ||
          (userPk === fe.maker.toString() && fe.takerSide === 'buy')
        ) {
          quantity = quantity.mul(NEG_ONE);
        }

        if (currBase.gt(ZERO) && quantity.gt(ZERO)) {
          // Means we are opening long
          baseChange = currBase.lt(quantity) ? currBase : quantity; // get min value
        } else if (currBase.lt(ZERO) && quantity.lt(ZERO)) {
          // means we are opening short
          baseChange = currBase.gt(quantity) ? currBase : quantity; // get max value
        } else {
          baseChange = quantity;
        }
      }

      totalQuoteChange = totalQuoteChange.sub(baseChange.mul(price));
      currBase = currBase.sub(baseChange);

      if (currBase.eq(ZERO)) {
        return totalQuoteChange.mul(NEG_ONE).div(basePos);
      }
    }

    // If we haven't returned yet, there was an error or missing data
    // TODO - consider failing silently
    throw new Error('Trade history incomplete');
  }
  getPnl(
    perpMarketInfo: PerpMarketInfo,
    perpMarketCache: PerpMarketCache,
    price: I80F48,
  ): I80F48 {
    return I80F48.fromI64(this.basePosition.mul(perpMarketInfo.baseLotSize))
      .mul(price)
      .add(this.getQuotePosition(perpMarketCache));
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
      this.bidsQuantity,
    );

    const asksHealth = this.simPositionHealth(
      perpMarketInfo,
      price,
      assetWeight,
      liabWeight,
      this.asksQuantity.neg(),
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

  getAssetVal(
    perpMarketInfo: PerpMarketInfo,
    price: I80F48,
    shortFunding: I80F48,
    longFunding: I80F48,
  ) {
    let assetsVal = ZERO_I80F48;

    if (this.basePosition.gt(ZERO_BN)) {
      assetsVal = assetsVal.add(
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

    if (realQuotePosition.gt(ZERO_I80F48)) {
      assetsVal = assetsVal.add(realQuotePosition);
    }
    return assetsVal;
  }

  getBasePositionUi(perpMarket: PerpMarket): number {
    return perpMarket.baseLotsToNumber(this.basePosition);
  }
}
