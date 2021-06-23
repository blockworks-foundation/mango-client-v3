import { OpenOrders } from '@project-serum/serum';
import { Connection, PublicKey } from '@solana/web3.js';
import { I80F48 } from './fixednum';
import {
  MAX_PAIRS,
  MangoAccountLayout,
  MangoCache,
  MetaData,
  PerpAccount,
  RootBankCache,
} from './layout';
import { promiseUndef, zeroKey } from './utils';
import MangoGroup, { QUOTE_INDEX } from './MangoGroup';
import RootBank from './RootBank';

export default class MangoAccount {
  publicKey: PublicKey;
  metaData!: MetaData;
  mangoGroup!: PublicKey;
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

  async reload(connection: Connection): Promise<MangoAccount> {
    const acc = await connection.getAccountInfo(this.publicKey);
    Object.assign(this, MangoAccountLayout.decode(acc?.data));
    return this;
  }

  getNativeDeposit(
    rootBank: RootBank | RootBankCache,
    tokenIndex: number,
  ): I80F48 {
    return rootBank.depositIndex.mul(this.deposits[tokenIndex]);
  }
  getNativeBorrow(
    rootBank: RootBank | RootBankCache,
    tokenIndex: number,
  ): I80F48 {
    return rootBank.borrowIndex.mul(this.borrows[tokenIndex]);
  }
  getUiDeposit(
    rootBank: RootBank | RootBankCache,
    mangoGroup: MangoGroup,
    tokenIndex: number,
  ): I80F48 {
    return this.getNativeDeposit(rootBank, tokenIndex).div(
      I80F48.fromNumber(Math.pow(10, mangoGroup.tokens[tokenIndex].decimals)),
    );
  }
  getUiBorrow(
    rootBank: RootBank | RootBankCache,
    mangoGroup: MangoGroup,
    tokenIndex: number,
  ): I80F48 {
    return this.getNativeBorrow(rootBank, tokenIndex).div(
      I80F48.fromNumber(Math.pow(10, mangoGroup.tokens[tokenIndex].decimals)),
    );
  }

  // TODO: use getMultipleAccounts instead
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

  getSpotHealth(mangoCache, marketIndex, assetWeight, liabWeight): I80F48 {
    const bankCache = mangoCache.rootBankCache[marketIndex];
    const price = mangoCache.priceCache[marketIndex].price;

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
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    healthType: HealthType,
  ): I80F48 {
    const quoteDeposits = this.getNativeDeposit(
      mangoCache.rootBankCache[QUOTE_INDEX],
      QUOTE_INDEX,
    );
    const quoteBorrows = this.getNativeBorrow(
      mangoCache.rootBankCache[QUOTE_INDEX],
      QUOTE_INDEX,
    );

    let health = quoteDeposits.sub(quoteBorrows);

    for (let i = 0; i < mangoGroup.numOracles; i++) {
      if (!this.inBasket[i]) {
        continue;
      }

      const spotMarket = mangoGroup.spotMarkets[i];
      const perpMarket = mangoGroup.perpMarkets[i];
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

      if (!mangoGroup.spotMarkets[i].isEmpty()) {
        health = health.add(
          this.getSpotHealth(mangoCache, i, spotAssetWeight, spotLiabWeight),
        );
      }

      if (!mangoGroup.perpMarkets[i].isEmpty()) {
        const perpsCache = mangoCache.perpMarketCache[i];
        health = health.add(
          this.perpAccounts[i].getHealth(
            perpMarket,
            mangoCache.priceCache[i].price,
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
