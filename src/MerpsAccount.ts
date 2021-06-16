import { OpenOrders } from '@project-serum/serum';
import { Connection, PublicKey } from '@solana/web3.js';
import { I80F48 } from './fixednum';
import {
  MAX_PAIRS,
  MerpsCache,
  MetaData,
  PerpAccount,
  RootBank,
  RootBankCache,
} from './layout';
import { promiseUndef, zeroKey } from './utils';
import MerpsGroup, { QUOTE_INDEX } from './MerpsGroup';

export default class MerpsAccount {
  publicKey: PublicKey;
  metaData!: MetaData;
  merpsGroup!: PublicKey;
  owner!: PublicKey;

  inBasket!: boolean[];
  deposits!: I80F48[];
  borrows!: I80F48[];

  spotOpenOrders!: PublicKey[];
  spotOpenOrdersAccounts: (OpenOrders | undefined)[];

  perpAccounts!: PerpAccount[];

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    this.spotOpenOrdersAccounts = new Array(MAX_PAIRS).fill(undefined);

    Object.assign(this, decoded);
  }

  getNativeDeposit(
    rootBank: RootBank | RootBankCache,
    tokenIndex: number,
  ): I80F48 {
    // TODO maybe load rootBank here instead of passing in?
    return rootBank.depositIndex.mul(this.deposits[tokenIndex]);
  }
  getNativeBorrow(
    rootBank: RootBank | RootBankCache,
    tokenIndex: number,
  ): I80F48 {
    return rootBank.borrowIndex.mul(this.borrows[tokenIndex]);
  }
  getUiDeposit(): number {
    throw new Error('not implemented');
  }
  getUiBorrow(): number {
    throw new Error('not implemented');
  }

  async loadOpenOrders(
    connection: Connection,
    serumDexPk: PublicKey,
  ): Promise<(OpenOrders | undefined)[]> {
    const promises: Promise<OpenOrders | undefined>[] = [];

    for (let i = 0; i < this.spotOpenOrders.length; i++) {
      if (this.spotOpenOrders[i].equals(zeroKey)) {
        promises.push(promiseUndef());
      } else {
        promises.push(
          OpenOrders.load(connection, this.spotOpenOrders[i], serumDexPk),
        );
      }
    }

    this.spotOpenOrdersAccounts = await Promise.all(promises);
    return this.spotOpenOrdersAccounts;
  }

  getSpotHealth(merpsCache, marketIndex, assetWeight, liabWeight): I80F48 {
    const bankCache = merpsCache.rootBankCache[marketIndex];
    const price = merpsCache.priceCache[marketIndex].price;

    let [ooBase, ooQuote] = [I80F48.fromString('0'), I80F48.fromString('0')];
    const oo = this.spotOpenOrdersAccounts[marketIndex];
    if (oo !== undefined) {
      [ooBase, ooQuote] = [
        I80F48.fromU64(oo.baseTokenTotal),
        I80F48.fromU64(oo.quoteTokenTotal.add(oo['referrerRebatesAccrued'])),
      ];
    }
    const baseAssets = this.getNativeDeposit(bankCache, marketIndex).add(
      ooBase,
    );
    const baseLiabs = this.getNativeBorrow(bankCache, marketIndex);

    // health = (baseAssets * aWeight - baseLiabs * lWeight) * price + ooQuote
    return baseAssets
      .mul(assetWeight)
      .sub(baseLiabs.mul(liabWeight))
      .mul(price)
      .add(ooQuote);
  }
  getHealth(
    merpsGroup: MerpsGroup,
    merpsCache: MerpsCache,
    healthType: HealthType,
  ): I80F48 {
    // A loss is the delta between the position marked to current market price vs. quote position

    const quoteDeposits = this.getNativeDeposit(
      merpsCache.rootBankCache[QUOTE_INDEX],
      QUOTE_INDEX,
    );
    const quoteBorrows = this.getNativeBorrow(
      merpsCache.rootBankCache[QUOTE_INDEX],
      QUOTE_INDEX,
    );

    let health = quoteDeposits.sub(quoteBorrows);

    for (let i = 0; i < merpsGroup.numOracles; i++) {
      if (!this.inBasket[i]) {
        continue;
      }

      const spotMarket = merpsGroup.spotMarkets[i];
      const perpMarket = merpsGroup.perpMarkets[i];
      const [spotAssetWeight, spotLiabWeight, perpAssetWeight, perpLiabWeight] =
        healthType === 'Maint'
          ? [
              spotMarket.maintAssetWeight,
              spotMarket.maintLiabWeight,
              perpMarket.maintAssetWeight,
              perpMarket.maintLiabWeight,
            ]
          : [
              spotMarket.initAssetWeight,
              spotMarket.initLiabWeight,
              perpMarket.initAssetWeight,
              perpMarket.initLiabWeight,
            ];

      if (!merpsGroup.spotMarkets[i].isEmpty()) {
        health = health.add(
          this.getSpotHealth(merpsCache, i, spotAssetWeight, spotLiabWeight),
        );
      }

      if (!merpsGroup.perpMarkets[i].isEmpty()) {
        const perpsCache = merpsCache.perpMarketCache[i];
        health = health.add(
          this.perpAccounts[i].getHealth(
            perpMarket,
            merpsCache.priceCache[i].price,
            perpAssetWeight,
            perpLiabWeight,
            perpsCache.longFunding,
            perpsCache.shortFunding,
          ),
        );
      }
    }

    return health;
  }
}

type HealthType = 'Init' | 'Maint';
