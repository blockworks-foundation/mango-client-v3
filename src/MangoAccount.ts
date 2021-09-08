import { Market, OpenOrders } from '@project-serum/serum';
import { Connection, PublicKey } from '@solana/web3.js';
import { I80F48, ONE_I80F48, ZERO_I80F48 } from './fixednum';
import {
  MAX_PAIRS,
  MangoAccountLayout,
  MangoCache,
  MetaData,
  RootBankCache,
  QUOTE_INDEX,
} from './layout';
import {
  getWeights,
  nativeI80F48ToUi,
  nativeToUi,
  promiseUndef,
  splitOpenOrders,
  zeroKey,
} from './utils';
import RootBank from './RootBank';
import BN from 'bn.js';
import MangoGroup from './MangoGroup';
import PerpAccount from './PerpAccount';
import { EOL } from 'os';
import {
  getMarketByPublicKey,
  getMultipleAccounts,
  getTokenByMint,
  GroupConfig,
  PerpMarketConfig,
  TokenConfig,
  ZERO_BN,
} from '.';
import PerpMarket from './PerpMarket';

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
  orderMarket!: number[];
  orderSide!: string[];
  orders!: BN[];
  clientOrderIds!: BN[];

  msrmAmount!: BN;

  beingLiquidated!: boolean;
  isBankrupt!: boolean;
  info!: number[];

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    this.spotOpenOrdersAccounts = new Array(MAX_PAIRS).fill(undefined);
    Object.assign(this, decoded);
  }

  get name(): string {
    return this.info
      ? String.fromCharCode(...this.info).replace(
          new RegExp(String.fromCharCode(0), 'g'),
          '',
        )
      : '';
  }

  async reload(
    connection: Connection,
    dexProgramId: PublicKey | undefined = undefined,
  ): Promise<MangoAccount> {
    const acc = await connection.getAccountInfo(this.publicKey);
    Object.assign(this, MangoAccountLayout.decode(acc?.data));
    if (dexProgramId) {
      await this.loadOpenOrders(connection, dexProgramId);
    }
    return this;
  }

  async loadOpenOrders(
    connection: Connection,
    serumDexPk: PublicKey,
  ): Promise<(OpenOrders | undefined)[]> {
    const accounts = await getMultipleAccounts(
      connection,
      this.spotOpenOrders.filter((pk) => !pk.equals(zeroKey)),
    );

    this.spotOpenOrdersAccounts = this.spotOpenOrders.map((openOrderPk) => {
      if (openOrderPk.equals(zeroKey)) {
        return undefined;
      }
      const account = accounts.find((a) => a.publicKey.equals(openOrderPk));
      return account
        ? OpenOrders.fromAccountInfo(
            openOrderPk,
            account.accountInfo,
            serumDexPk,
          )
        : undefined;
    });
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
      this.getNativeDeposit(rootBank, tokenIndex).floor(),
      mangoGroup.tokens[tokenIndex].decimals,
    );
  }
  getUiBorrow(
    rootBank: RootBank | RootBankCache,
    mangoGroup: MangoGroup,
    tokenIndex: number,
  ): I80F48 {
    return nativeI80F48ToUi(
      this.getNativeBorrow(rootBank, tokenIndex).ceil(),
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

      const price = mangoGroup.getPrice(i, mangoCache);
      const perpsUiAssetVal = nativeI80F48ToUi(
        this.perpAccounts[i].getAssetVal(
          mangoGroup.perpMarkets[i],
          price,
          mangoCache.perpMarketCache[i].shortFunding,
          mangoCache.perpMarketCache[i].longFunding,
        ),
        mangoGroup.tokens[QUOTE_INDEX].decimals,
      );

      assetsVal = assetsVal.add(perpsUiAssetVal);
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
      const price = mangoGroup.getPrice(i, mangoCache);
      if (healthType === 'Maint') {
        liabWeight = mangoGroup.spotMarkets[i].maintLiabWeight;
      } else if (healthType === 'Init') {
        liabWeight = mangoGroup.spotMarkets[i].initLiabWeight;
      }

      liabsVal = liabsVal.add(
        this.getUiBorrow(mangoCache.rootBankCache[i], mangoGroup, i).mul(
          price.mul(liabWeight),
        ),
      );

      const perpsUiLiabsVal = nativeI80F48ToUi(
        this.perpAccounts[i].getLiabsVal(
          mangoGroup.perpMarkets[i],
          price,
          mangoCache.perpMarketCache[i].shortFunding,
          mangoCache.perpMarketCache[i].longFunding,
        ),
        mangoGroup.tokens[QUOTE_INDEX].decimals,
      );

      liabsVal = liabsVal.add(perpsUiLiabsVal);
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

      liabsVal = liabsVal.add(
        this.perpAccounts[i].getLiabsVal(
          mangoGroup.perpMarkets[i],
          price,
          mangoCache.perpMarketCache[i].shortFunding,
          mangoCache.perpMarketCache[i].longFunding,
        ),
      );
    }
    return liabsVal;
  }

  /**
   * deposits - borrows in native terms
   */
  getNet(bankCache: RootBankCache, tokenIndex: number): I80F48 {
    return this.deposits[tokenIndex]
      .mul(bankCache.depositIndex)
      .sub(this.borrows[tokenIndex].mul(bankCache.borrowIndex));
  }

  /**
   * Take health components and return the assets and liabs weighted
   */
  getWeightedAssetsLiabsVals(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    spot: I80F48[],
    perps: I80F48[],
    quote: I80F48,
    healthType?: HealthType,
  ): { assets: I80F48; liabs: I80F48 } {
    let assets = ZERO_I80F48;
    let liabs = ZERO_I80F48;

    if (quote.isPos()) {
      assets = assets.add(quote);
    } else {
      liabs = liabs.add(quote.neg());
    }

    for (let i = 0; i < mangoGroup.numOracles; i++) {
      const w = getWeights(mangoGroup, i, healthType);
      const price = mangoCache.priceCache[i].price;
      if (spot[i].isPos()) {
        assets = spot[i].mul(price).mul(w.spotAssetWeight).add(assets);
      } else {
        liabs = spot[i].neg().mul(price).mul(w.spotLiabWeight).add(liabs);
      }

      if (perps[i].isPos()) {
        assets = perps[i].mul(price).mul(w.perpAssetWeight).add(assets);
      } else {
        liabs = perps[i].neg().mul(price).mul(w.perpLiabWeight).add(liabs);
      }
    }
    return { assets, liabs };
  }

  getHealthFromComponents(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    spot: I80F48[],
    perps: I80F48[],
    quote: I80F48,
    healthType: HealthType,
  ): I80F48 {
    let health = quote;
    for (let i = 0; i < mangoGroup.numOracles; i++) {
      const w = getWeights(mangoGroup, i, healthType);
      const price = mangoCache.priceCache[i].price;
      const spotHealth = spot[i]
        .mul(price)
        .mul(spot[i].isPos() ? w.spotAssetWeight : w.spotLiabWeight);
      const perpHealth = perps[i]
        .mul(price)
        .mul(perps[i].isPos() ? w.perpAssetWeight : w.perpLiabWeight);

      health = health.add(spotHealth).add(perpHealth);
    }

    return health;
  }

  getHealthsFromComponents(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    spot: I80F48[],
    perps: I80F48[],
    quote: I80F48,
    healthType: HealthType,
  ): { spot: I80F48; perp: I80F48 } {
    let spotHealth = quote;
    let perpHealth = quote;
    for (let i = 0; i < mangoGroup.numOracles; i++) {
      const w = getWeights(mangoGroup, i, healthType);
      const price = mangoCache.priceCache[i].price;
      const _spotHealth = spot[i]
        .mul(price)
        .mul(spot[i].isPos() ? w.spotAssetWeight : w.spotLiabWeight);
      const _perpHealth = perps[i]
        .mul(price)
        .mul(perps[i].isPos() ? w.perpAssetWeight : w.perpLiabWeight);

      spotHealth = spotHealth.add(_spotHealth);
      perpHealth = perpHealth.add(_perpHealth);
    }

    return { spot: spotHealth, perp: perpHealth };
  }
  /**
   * Amount of native quote currency available to expand your position in this market
   */
  getMarketMarginAvailable(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    marketIndex: number,
    marketType: 'spot' | 'perp',
  ): I80F48 {
    const health = this.getHealth(mangoGroup, mangoCache, 'Init');

    if (health.lte(ZERO_I80F48)) {
      return ZERO_I80F48;
    }
    const w = getWeights(mangoGroup, marketIndex, 'Init');
    const weight =
      marketType === 'spot' ? w.spotAssetWeight : w.perpAssetWeight;
    if (weight.gte(ONE_I80F48)) {
      // This is actually an error state and should not happen
      return health;
    } else {
      return health.div(ONE_I80F48.sub(weight));
    }
  }

  /**
   * Get token amount available to withdraw without borrowing.
   */
  getAvailableBalance(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    tokenIndex: number,
  ): I80F48 {
    const health = this.getHealth(mangoGroup, mangoCache, 'Init');
    const net = this.getNet(mangoCache.rootBankCache[tokenIndex], tokenIndex);

    if (tokenIndex === QUOTE_INDEX) {
      return health.min(net).max(ZERO_I80F48);
    } else {
      const w = getWeights(mangoGroup, tokenIndex, 'Init');

      return net
        .min(
          health
            .div(w.spotAssetWeight)
            .div(mangoCache.priceCache[tokenIndex].price),
        )
        .max(ZERO_I80F48);
    }
  }

  /**
   * Return the spot, perps and quote currency values after adjusting for
   * worst case open orders scenarios. These values are not adjusted for health
   * type
   * @param mangoGroup
   * @param mangoCache
   */
  getHealthComponents(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
  ): { spot: I80F48[]; perps: I80F48[]; quote: I80F48 } {
    const spot = Array(mangoGroup.numOracles).fill(ZERO_I80F48);
    const perps = Array(mangoGroup.numOracles).fill(ZERO_I80F48);
    let quote = this.getNet(mangoCache.rootBankCache[QUOTE_INDEX], QUOTE_INDEX);

    for (let i = 0; i < mangoGroup.numOracles; i++) {
      const bankCache = mangoCache.rootBankCache[i];
      const price = mangoCache.priceCache[i].price;
      const baseNet = this.getNet(bankCache, i);

      // Evaluate spot first
      const openOrders = this.spotOpenOrdersAccounts[i];
      if (this.inMarginBasket[i] && openOrders !== undefined) {
        const { quoteFree, quoteLocked, baseFree, baseLocked } =
          splitOpenOrders(openOrders);

        // base total if all bids were executed
        const bidsBaseNet = baseNet
          .add(quoteLocked.div(price))
          .add(baseFree)
          .add(baseLocked);

        // base total if all asks were executed
        const asksBaseNet = baseNet.add(baseFree);

        // bids case worse if it has a higher absolute position
        if (bidsBaseNet.abs().gt(asksBaseNet.abs())) {
          spot[i] = bidsBaseNet;
          quote = quote.add(quoteFree);
        } else {
          spot[i] = asksBaseNet;
          quote = baseLocked
            .mul(price)
            .add(quoteFree)
            .add(quoteLocked)
            .add(quote);
        }
      } else {
        spot[i] = baseNet;
      }

      // Evaluate perps
      if (!mangoGroup.perpMarkets[i].perpMarket.equals(zeroKey)) {
        const perpMarketCache = mangoCache.perpMarketCache[i];
        const perpAccount = this.perpAccounts[i];
        const baseLotSize = mangoGroup.perpMarkets[i].baseLotSize;
        const quoteLotSize = mangoGroup.perpMarkets[i].quoteLotSize;
        const takerQuote = I80F48.fromI64(
          perpAccount.takerQuote.mul(quoteLotSize),
        );
        const basePos = I80F48.fromI64(
          perpAccount.basePosition.add(perpAccount.takerBase).mul(baseLotSize),
        );
        const bidsQuantity = I80F48.fromI64(
          perpAccount.bidsQuantity.mul(baseLotSize),
        );
        const asksQuantity = I80F48.fromI64(
          perpAccount.asksQuantity.mul(baseLotSize),
        );

        const bidsBaseNet = basePos.add(bidsQuantity);
        const asksBaseNet = basePos.sub(asksQuantity);

        if (bidsBaseNet.abs().gt(asksBaseNet.abs())) {
          const quotePos = perpAccount
            .getQuotePosition(perpMarketCache)
            .add(takerQuote)
            .sub(bidsQuantity.mul(price));
          quote = quote.add(quotePos);
          perps[i] = bidsBaseNet;
        } else {
          const quotePos = perpAccount
            .getQuotePosition(perpMarketCache)
            .add(takerQuote)
            .add(asksQuantity.mul(price));
          quote = quote.add(quotePos);
          perps[i] = asksBaseNet;
        }
      } else {
        perps[i] = ZERO_I80F48;
      }
    }

    return { spot, perps, quote };
  }

  getHealth(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    healthType: HealthType,
  ): I80F48 {
    const { spot, perps, quote } = this.getHealthComponents(
      mangoGroup,
      mangoCache,
    );
    const health = this.getHealthFromComponents(
      mangoGroup,
      mangoCache,
      spot,
      perps,
      quote,
      healthType,
    );
    return health;
  }

  getHealthRatio(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    healthType: HealthType,
  ): I80F48 {
    const { spot, perps, quote } = this.getHealthComponents(
      mangoGroup,
      mangoCache,
    );

    const { assets, liabs } = this.getWeightedAssetsLiabsVals(
      mangoGroup,
      mangoCache,
      spot,
      perps,
      quote,
      healthType,
    );

    if (liabs.gt(ZERO_I80F48)) {
      return assets.div(liabs).sub(ONE_I80F48).mul(I80F48.fromNumber(100));
    } else {
      return I80F48.fromNumber(100);
    }
  }

  computeValue(mangoGroup: MangoGroup, mangoCache: MangoCache): I80F48 {
    return this.getAssetsVal(mangoGroup, mangoCache).sub(
      this.getLiabsVal(mangoGroup, mangoCache),
    );
  }

  getLeverage(mangoGroup: MangoGroup, mangoCache: MangoCache): I80F48 {
    const liabs = this.getLiabsVal(mangoGroup, mangoCache);
    const assets = this.getAssetsVal(mangoGroup, mangoCache);

    if (assets.gt(ZERO_I80F48)) {
      return liabs.div(assets.sub(liabs));
    }
    return ZERO_I80F48;
  }

  getMaxLeverageForMarket(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    marketIndex: number,
    market: Market | PerpMarket,
    side: 'buy' | 'sell',
    price: I80F48,
  ): {
    max: I80F48;
    uiDepositVal: I80F48;
    deposits: I80F48;
    uiBorrowVal: I80F48;
    borrows: I80F48;
  } {
    const initHealth = this.getHealth(mangoGroup, mangoCache, 'Init');
    const healthDecimals = I80F48.fromNumber(
      Math.pow(10, mangoGroup.tokens[QUOTE_INDEX].decimals),
    );
    const uiInitHealth = initHealth.div(healthDecimals);

    let uiDepositVal = ZERO_I80F48;
    let uiBorrowVal = ZERO_I80F48;
    let initLiabWeight, initAssetWeight, deposits, borrows;

    if (market instanceof PerpMarket) {
      ({ initLiabWeight, initAssetWeight } =
        mangoGroup.perpMarkets[marketIndex]);

      const basePos = this.perpAccounts[marketIndex].basePosition;

      if (basePos.gt(ZERO_BN)) {
        deposits = I80F48.fromNumber(market.baseLotsToNumber(basePos));
        uiDepositVal = deposits.mul(price);
      } else {
        borrows = I80F48.fromNumber(market.baseLotsToNumber(basePos)).abs();
        uiBorrowVal = borrows.mul(price);
      }
    } else {
      ({ initLiabWeight, initAssetWeight } =
        mangoGroup.spotMarkets[marketIndex]);

      deposits = this.getUiDeposit(
        mangoCache.rootBankCache[marketIndex],
        mangoGroup,
        marketIndex,
      );
      uiDepositVal = deposits.mul(price);

      borrows = this.getUiBorrow(
        mangoCache.rootBankCache[marketIndex],
        mangoGroup,
        marketIndex,
      );
      uiBorrowVal = borrows.mul(price);
    }

    let max;
    if (side === 'buy') {
      const uiHealthAtZero = uiInitHealth.add(
        uiBorrowVal.mul(initLiabWeight.sub(ONE_I80F48)),
      );
      max = uiHealthAtZero
        .div(ONE_I80F48.sub(initAssetWeight))
        .add(uiBorrowVal);
    } else {
      const uiHealthAtZero = uiInitHealth.add(
        uiDepositVal.mul(ONE_I80F48.sub(initAssetWeight)),
      );
      max = uiHealthAtZero
        .div(initLiabWeight.sub(ONE_I80F48))
        .add(uiDepositVal);
    }

    return { max, uiBorrowVal, uiDepositVal, deposits, borrows };
  }

  getMaxWithBorrowForToken(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    tokenIndex: number,
  ): I80F48 {
    const oldInitHealth = this.getHealth(
      mangoGroup,
      mangoCache,
      'Init',
    ).floor();
    const tokenDeposits = this.getNativeDeposit(
      mangoCache.rootBankCache[tokenIndex],
      tokenIndex,
    ).floor();

    let liabWeight, assetWeight, nativePrice;
    if (tokenIndex === QUOTE_INDEX) {
      liabWeight = assetWeight = nativePrice = ONE_I80F48;
    } else {
      liabWeight = mangoGroup.spotMarkets[tokenIndex].initLiabWeight;
      assetWeight = mangoGroup.spotMarkets[tokenIndex].initAssetWeight;
      nativePrice = mangoCache.priceCache[tokenIndex].price;
    }

    const newInitHealth = oldInitHealth
      .sub(tokenDeposits.mul(nativePrice).mul(assetWeight))
      .floor();
    const price = mangoGroup.getPrice(tokenIndex, mangoCache);
    const healthDecimals = I80F48.fromNumber(
      Math.pow(10, mangoGroup.tokens[QUOTE_INDEX].decimals),
    );

    return newInitHealth.div(healthDecimals).div(price.mul(liabWeight));
  }

  toPrettyString(
    groupConfig: GroupConfig,
    mangoGroup: MangoGroup,
    cache: MangoCache,
  ): string {
    const lines: string[] = [];
    lines.push('MangoAccount ' + this.publicKey.toBase58());
    lines.push('Owner: ' + this.owner.toBase58());
    lines.push(
      'Maint Health Ratio: ' + this.getHealthRatio(mangoGroup, cache, 'Maint'),
    );
    lines.push('isBankrupt: ' + this.isBankrupt);

    lines.push('Spot:');

    for (let i = 0; i < mangoGroup.tokens.length; i++) {
      if (
        mangoGroup.tokens[i].mint.equals(zeroKey) ||
        (this.deposits[i].eq(ZERO_I80F48) && this.borrows[i].eq(ZERO_I80F48))
      ) {
        continue;
      }

      const token = getTokenByMint(
        groupConfig,
        mangoGroup.tokens[i].mint,
      ) as TokenConfig;

      lines.push(
        token.symbol +
          ': ' +
          nativeI80F48ToUi(
            this.deposits[i].mul(cache.rootBankCache[i].depositIndex),
            mangoGroup.tokens[i].decimals,
          ).toFixed(4) +
          ' / ' +
          nativeI80F48ToUi(
            this.borrows[i].mul(cache.rootBankCache[i].borrowIndex),
            mangoGroup.tokens[i].decimals,
          ).toFixed(4),
      );
    }
    lines.push('Perps:');
    for (let i = 0; i < this.perpAccounts.length; i++) {
      if (mangoGroup.perpMarkets[i].perpMarket.equals(zeroKey)) {
        continue;
      }
      const market = getMarketByPublicKey(
        groupConfig,
        mangoGroup.perpMarkets[i].perpMarket,
      ) as PerpMarketConfig;

      const perpAccount = this.perpAccounts[i];
      const perpMarketInfo = mangoGroup.perpMarkets[i];
      lines.push(
        market.name +
          ': ' +
          perpAccount.basePosition.toString() +
          ' / ' +
          perpAccount.quotePosition.toString() +
          ' / ' +
          perpAccount.getUnsettledFunding(cache.perpMarketCache[i]).toString() +
          ' / ' +
          perpAccount.getHealth(
            perpMarketInfo,
            cache.priceCache[i].price,
            perpMarketInfo.maintAssetWeight,
            perpMarketInfo.maintLiabWeight,
            cache.perpMarketCache[i].longFunding,
            cache.perpMarketCache[i].shortFunding,
          ),
      );
    }
    return lines.join(EOL);
  }
}

export type HealthType = 'Init' | 'Maint';
