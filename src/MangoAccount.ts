import { OpenOrders } from '@project-serum/serum';
import { Connection, PublicKey } from '@solana/web3.js';
import { I80F48, ONE_I80F48, ZERO_I80F48 } from './fixednum';
import {
  MAX_PAIRS,
  MangoAccountLayout,
  MangoCache,
  MetaData,
  PerpAccount,
  RootBankCache,
} from './layout';
import { nativeI80F48ToUi, nativeToUi, promiseUndef, zeroKey } from './utils';
import MangoGroup, { QUOTE_INDEX } from './MangoGroup';
import RootBank from './RootBank';

export default class MangoAccount {
  publicKey: PublicKey;
  metaData!: MetaData;
  mangoGroup!: PublicKey;
  owner!: PublicKey;

  inMarginBasket!: boolean[];
  numInMarginBasket!: number;
  deposits!: I80F48[];
  borrows!: I80F48[];

  spotOpenOrders!: PublicKey[];
  spotOpenOrdersAccounts: (OpenOrders | undefined)[];

  perpAccounts!: PerpAccount[];

  beingLiquidated!: boolean;
  isBankrupt!: boolean;

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
    return nativeI80F48ToUi(
      this.getNativeDeposit(rootBank, tokenIndex),
      mangoGroup.tokens[tokenIndex].decimals,
    );
  }
  getUiBorrow(
    rootBank: RootBank | RootBankCache,
    mangoGroup: MangoGroup,
    tokenIndex: number,
  ): I80F48 {
    return nativeI80F48ToUi(
      this.getNativeBorrow(rootBank, tokenIndex),
      mangoGroup.tokens[tokenIndex].decimals,
    );
  }

  getSpotVal(mangoGroup, mangoCache, index, assetWeight) {
    let assetsVal = ZERO_I80F48;
    const price = mangoGroup.getPrice(index, mangoCache);

    const depositVal = this.getUiDeposit(
      mangoCache.rootBankCache[index],
      mangoGroup,
      index,
    )
      .mul(price)
      .mul(assetWeight);
    assetsVal = assetsVal.add(depositVal);

    const openOrdersAccount = this.spotOpenOrdersAccounts[index];
    if (openOrdersAccount !== undefined) {
      assetsVal = assetsVal.add(
        I80F48.fromNumber(
          nativeToUi(
            openOrdersAccount.baseTokenTotal.toNumber(),
            mangoGroup.tokens[index].decimals,
          ),
        )
          .mul(price)
          .mul(assetWeight),
      );
      assetsVal = assetsVal.add(
        I80F48.fromNumber(
          nativeToUi(
            openOrdersAccount.quoteTokenTotal.toNumber() +
              openOrdersAccount['referrerRebatesAccrued'].toNumber(),
            mangoGroup.tokens[QUOTE_INDEX].decimals,
          ),
        ),
      );
    }

    return assetsVal;
  }

  getAssetsVal(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    healthType?: HealthType,
  ): I80F48 {
    let assetsVal = ZERO_I80F48;

    // quote currency deposits
    assetsVal = assetsVal.add(
      this.getUiDeposit(
        mangoCache.rootBankCache[QUOTE_INDEX],
        mangoGroup,
        QUOTE_INDEX,
      ),
    );

    for (let i = 0; i < mangoGroup.numOracles; i++) {
      let assetWeight = ONE_I80F48;
      if (healthType === 'Maint') {
        assetWeight = mangoGroup.spotMarkets[i].maintAssetWeight;
      } else if (healthType === 'Init') {
        assetWeight = mangoGroup.spotMarkets[i].initAssetWeight;
      }

      const spotVal = this.getSpotVal(mangoGroup, mangoCache, i, assetWeight);
      assetsVal = assetsVal.add(spotVal);

      // TODO get perp value
    }

    return assetsVal;
  }

  getLiabsVal(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    healthType?: HealthType,
  ): I80F48 {
    let liabsVal = ZERO_I80F48;

    liabsVal = liabsVal.add(
      this.getUiBorrow(
        mangoCache.rootBankCache[QUOTE_INDEX],
        mangoGroup,
        QUOTE_INDEX,
      ),
    );

    for (let i = 0; i < mangoGroup.numOracles; i++) {
      let liabWeight = ONE_I80F48;
      if (healthType === 'Maint') {
        liabWeight = mangoGroup.spotMarkets[i].maintLiabWeight;
      } else if (healthType === 'Init') {
        liabWeight = mangoGroup.spotMarkets[i].initLiabWeight;
      }

      liabsVal = liabsVal.add(
        this.getUiBorrow(mangoCache.rootBankCache[i], mangoGroup, i).mul(
          mangoGroup.getPrice(i, mangoCache).mul(liabWeight),
        ),
      );
    }
    return liabsVal;
  }

  getNativeLiabsVal(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    healthType?: HealthType,
  ): I80F48 {
    let liabsVal = ZERO_I80F48;

    liabsVal = liabsVal.add(
      this.getNativeBorrow(mangoCache.rootBankCache[QUOTE_INDEX], QUOTE_INDEX),
    );

    for (let i = 0; i < mangoGroup.numOracles; i++) {
      const price = mangoCache.priceCache[i].price;
      let liabWeight = ONE_I80F48;
      if (healthType === 'Maint') {
        liabWeight = mangoGroup.spotMarkets[i].maintLiabWeight;
      } else if (healthType === 'Init') {
        liabWeight = mangoGroup.spotMarkets[i].initLiabWeight;
      }

      liabsVal = liabsVal.add(
        this.getNativeBorrow(mangoCache.rootBankCache[i], i).mul(
          price.mul(liabWeight),
        ),
      );
    }
    return liabsVal;
  }

  getSpotHealth(mangoCache, marketIndex, assetWeight, liabWeight): I80F48 {
    const bankCache = mangoCache.rootBankCache[marketIndex];
    const price = mangoCache.priceCache[marketIndex].price;

    const baseNet = this.deposits[marketIndex]
      .mul(bankCache.depositIndex)
      .sub(this.borrows[marketIndex].mul(bankCache.borrowIndex));

    let health = I80F48.fromNumber(0);

    if (
      !this.inMarginBasket[marketIndex] ||
      this.spotOpenOrders[marketIndex].equals(zeroKey)
    ) {
      if (!baseNet.isNeg()) {
        health = baseNet.mul(assetWeight).mul(price);
      } else {
        health = baseNet.mul(liabWeight).mul(price);
      }
    } else {
      const openOrders = this.spotOpenOrdersAccounts[marketIndex];
      if (openOrders !== undefined) {
        const quoteFree = new I80F48(
          openOrders.quoteTokenFree.add(openOrders['referrerRebatesAccrued']),
        );
        const quoteLocked = new I80F48(
          openOrders.quoteTokenTotal.sub(openOrders.quoteTokenFree),
        );
        const baseFree = new I80F48(openOrders.baseTokenFree);
        const baseLocked = new I80F48(
          openOrders.baseTokenTotal.sub(openOrders.baseTokenFree),
        );

        const bidsBaseNet = baseNet
          .add(quoteLocked.div(price))
          .add(baseFree)
          .add(baseLocked);
        const bidsWeight = !bidsBaseNet.isNeg() ? assetWeight : liabWeight;
        const bidsHealth = bidsBaseNet
          .mul(bidsWeight)
          .mul(price)
          .add(quoteFree);

        const asksBaseNet = baseNet.sub(baseLocked).add(baseFree);
        const asksWeight = !bidsBaseNet.isNeg() ? assetWeight : liabWeight;
        const asksHealth = asksBaseNet
          .mul(asksWeight)
          .mul(price)
          .add(price.mul(baseLocked))
          .add(quoteFree)
          .add(quoteLocked);

        health = bidsHealth.min(asksHealth);
      }
    }

    return health;
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
        const spotHealth = this.getSpotHealth(
          mangoCache,
          i,
          spotAssetWeight,
          spotLiabWeight,
        );

        health = health.add(spotHealth);
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

  getHealthRatio(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    healthType: HealthType,
  ): number {
    const health = this.getHealth(mangoGroup, mangoCache, healthType);
    const liabsVal = this.getNativeLiabsVal(mangoGroup, mangoCache, healthType);

    let healthRatio = 100;
    if (liabsVal.gt(ZERO_I80F48)) {
      healthRatio = health.div(liabsVal).toNumber() * 100;
    }

    return Math.max(healthRatio, 0);
  }

  computeValue(mangoGroup: MangoGroup, mangoCache: MangoCache): I80F48 {
    let value = ZERO_I80F48;

    value = value.add(
      this.getUiDeposit(
        mangoCache.rootBankCache[QUOTE_INDEX],
        mangoGroup,
        QUOTE_INDEX,
      ).sub(
        this.getUiBorrow(
          mangoCache.rootBankCache[QUOTE_INDEX],
          mangoGroup,
          QUOTE_INDEX,
        ),
      ),
    );

    for (let i = 0; i < mangoGroup.numOracles; i++) {
      value = value.add(
        this.getUiDeposit(mangoCache.rootBankCache[i], mangoGroup, i)
          .sub(this.getUiBorrow(mangoCache.rootBankCache[i], mangoGroup, i))
          .mul(mangoGroup.getPrice(i, mangoCache)),
      );
    }

    // TODO add perp vals

    for (let i = 0; i < this.spotOpenOrdersAccounts.length; i++) {
      const oos = this.spotOpenOrdersAccounts[i];
      if (oos != undefined) {
        value = value.add(
          I80F48.fromNumber(
            nativeToUi(
              oos.baseTokenTotal.toNumber(),
              mangoGroup.tokens[i].decimals,
            ),
          ).mul(mangoGroup.getPrice(i, mangoCache)),
        );
        value = value.add(
          I80F48.fromNumber(
            nativeToUi(
              oos.quoteTokenTotal.toNumber() +
                oos['referrerRebatesAccrued'].toNumber(),
              mangoGroup.tokens[QUOTE_INDEX].decimals,
            ),
          ),
        );
      }
    }

    return value;
  }
}

type HealthType = 'Init' | 'Maint';
