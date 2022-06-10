import { Market, OpenOrders, Orderbook } from '@project-serum/serum';
import { AccountInfo, Connection, PublicKey } from '@solana/web3.js';
import { I80F48, ONE_I80F48, ZERO_I80F48 } from './utils/fixednum';
import {
  FREE_ORDER_SLOT,
  MangoAccountLayout,
  MangoCache,
  MAX_PAIRS,
  MetaData,
  QUOTE_INDEX,
  RootBankCache,
} from './layout';
import {
  getWeights,
  nativeI80F48ToUi,
  nativeToUi,
  splitOpenOrders,
  zeroKey,
} from './utils/utils';
import RootBank from './RootBank';
import BN from 'bn.js';
import MangoGroup from './MangoGroup';
import PerpAccount from './PerpAccount';
import { EOL } from 'os';
import { getPriceFromKey } from './book';
import {
  getMarketByPublicKey,
  getTokenByMint,
  GroupConfig,
  PerpMarketConfig,
  Config,
  TokenConfig,
} from './config';
import { getMultipleAccounts, sleep, ZERO_BN } from './utils/utils';
import { AdvancedOrdersLayout, PerpTriggerOrder } from './layout';
import PerpMarket from './PerpMarket';
import { Order } from '@project-serum/serum/lib/market';
import IDS from './ids.json';

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

  advancedOrdersKey!: PublicKey;
  advancedOrders: { perpTrigger?: PerpTriggerOrder }[];

  notUpgradable!: boolean;
  delegate!: PublicKey;

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    this.spotOpenOrdersAccounts = new Array(MAX_PAIRS).fill(undefined);
    this.advancedOrders = [];
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

  getLiquidationPrice(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    oracleIndex: number,
  ): I80F48 | undefined {
    const { spot, perps, quote } = this.getHealthComponents(
      mangoGroup,
      mangoCache,
    );

    let partialHealth = quote;
    let weightedAsset = ZERO_I80F48;
    for (let i = 0; i < mangoGroup.numOracles; i++) {
      const w = getWeights(mangoGroup, i, 'Maint');
      if (i === oracleIndex) {
        const weightedSpot = spot[i].mul(
          spot[i].isPos() ? w.spotAssetWeight : w.spotLiabWeight,
        );
        const weightedPerps = perps[i].mul(
          perps[i].isPos() ? w.perpAssetWeight : w.perpLiabWeight,
        );
        weightedAsset = weightedSpot.add(weightedPerps).neg();
      } else {
        const price = mangoCache.priceCache[i].price;
        const spotHealth = spot[i]
          .mul(price)
          .mul(spot[i].isPos() ? w.spotAssetWeight : w.spotLiabWeight);
        const perpHealth = perps[i]
          .mul(price)
          .mul(perps[i].isPos() ? w.perpAssetWeight : w.perpLiabWeight);
        partialHealth = partialHealth.add(spotHealth).add(perpHealth);
      }
    }

    if (weightedAsset.isZero()) {
      return undefined;
    }
    const liqPrice = partialHealth.div(weightedAsset);
    if (liqPrice.isNeg()) {
      return undefined;
    }
    return liqPrice.mul(
      // adjust for decimals in the price
      I80F48.fromNumber(
        Math.pow(
          10,
          mangoGroup.tokens[oracleIndex].decimals -
            mangoGroup.tokens[QUOTE_INDEX].decimals,
        ),
      ),
    );
  }

  hasAnySpotOrders(): boolean {
    return this.inMarginBasket.some((b) => b);
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

  /**
   * DEPRECATED
   */
  async reloadFromSlot(
    connection: Connection,
    lastSlot = 0,
    dexProgramId: PublicKey | undefined = undefined,
  ): Promise<[MangoAccount, number]> {
    let slot = -1;
    let value: AccountInfo<Buffer> | null = null;

    while (slot <= lastSlot) {
      const response = await connection.getAccountInfoAndContext(
        this.publicKey,
      );
      slot = response.context?.slot;
      value = response.value;
      await sleep(250);
    }

    Object.assign(this, MangoAccountLayout.decode(value?.data));
    if (dexProgramId) {
      await this.loadOpenOrders(connection, dexProgramId);
    }
    return [this, slot];
  }

  async loadSpotOrdersForMarket(
    connection: Connection,
    market: Market,
    marketIndex: number,
  ): Promise<Order[]> {
    const [bidsInfo, asksInfo] = await getMultipleAccounts(connection, [
      market.bidsAddress,
      market.asksAddress,
    ]);

    const bids = Orderbook.decode(market, bidsInfo.accountInfo.data);
    const asks = Orderbook.decode(market, asksInfo.accountInfo.data);

    return [...bids, ...asks].filter((o) =>
      o.openOrdersAddress.equals(this.spotOpenOrders[marketIndex]),
    );
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

  async loadAdvancedOrders(
    connection: Connection,
  ): Promise<{ perpTrigger?: PerpTriggerOrder }[]> {
    if (this.advancedOrdersKey.equals(zeroKey)) return [];

    const acc = await connection.getAccountInfo(this.advancedOrdersKey);
    const decoded = AdvancedOrdersLayout.decode(acc?.data);
    this.advancedOrders = decoded.orders;
    return decoded.orders;
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
      mangoGroup.getTokenDecimals(tokenIndex),
    );
  }
  getUiBorrow(
    rootBank: RootBank | RootBankCache,
    mangoGroup: MangoGroup,
    tokenIndex: number,
  ): I80F48 {
    return nativeI80F48ToUi(
      this.getNativeBorrow(rootBank, tokenIndex).ceil(),
      mangoGroup.getTokenDecimals(tokenIndex),
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

      const price = mangoCache.priceCache[i].price;
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
          mangoCache.priceCache[i].price,
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
    const health = quote;
    for (let i = 0; i < mangoGroup.numOracles; i++) {
      const w = getWeights(mangoGroup, i, healthType);
      const price = mangoCache.priceCache[i].price;
      const spotHealth = spot[i]
        .mul(price)
        .imul(spot[i].isPos() ? w.spotAssetWeight : w.spotLiabWeight);
      const perpHealth = perps[i]
        .mul(price)
        .imul(perps[i].isPos() ? w.perpAssetWeight : w.perpLiabWeight);

      health.iadd(spotHealth).iadd(perpHealth);
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
    const spotHealth = quote;
    const perpHealth = quote;
    for (let i = 0; i < mangoGroup.numOracles; i++) {
      const w = getWeights(mangoGroup, i, healthType);
      const price = mangoCache.priceCache[i].price;
      const _spotHealth = spot[i]
        .mul(price)
        .imul(spot[i].isPos() ? w.spotAssetWeight : w.spotLiabWeight);
      const _perpHealth = perps[i]
        .mul(price)
        .imul(perps[i].isPos() ? w.perpAssetWeight : w.perpLiabWeight);

      spotHealth.iadd(_spotHealth);
      perpHealth.iadd(_perpHealth);
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
    const quote = this.getNet(
      mangoCache.rootBankCache[QUOTE_INDEX],
      QUOTE_INDEX,
    );

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
          .iadd(baseFree)
          .iadd(baseLocked);

        // base total if all asks were executed
        const asksBaseNet = baseNet.add(baseFree);

        // bids case worse if it has a higher absolute position
        if (bidsBaseNet.abs().gt(asksBaseNet.abs())) {
          spot[i] = bidsBaseNet;
          quote.iadd(quoteFree);
        } else {
          spot[i] = asksBaseNet;
          quote.iadd(baseLocked.mul(price)).iadd(quoteFree).iadd(quoteLocked);
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
          perpAccount.basePosition.add(perpAccount.takerBase).imul(baseLotSize),
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
            .isub(bidsQuantity.mul(price));
          quote.iadd(quotePos);
          perps[i] = bidsBaseNet;
        } else {
          const quotePos = perpAccount
            .getQuotePosition(perpMarketCache)
            .add(takerQuote)
            .iadd(asksQuantity.mul(price));
          quote.iadd(quotePos);
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

  /**
   * Get the value of unclaimed MNGO liquidity mining rewards
   */
  mgnoAccruedValue(mangoGroup: MangoGroup, mangoCache: MangoCache): I80F48 {
    const config = new Config(IDS);
    const groupConfig = config.groups.find((g) =>
      g.publicKey.equals(mangoGroup.publicKey),
    ) as GroupConfig;

    const mngoOracleIndex = groupConfig.oracles.findIndex(
      (t) => t.symbol === 'MNGO',
    );
    const mngoTokenIndex = groupConfig.tokens.findIndex(
      (t) => t.symbol === 'MNGO',
    );

    const mngoPrice = mangoCache.priceCache[mngoOracleIndex].price;
    const mngoDecimals = mangoGroup.tokens[mngoTokenIndex].decimals;

    let val = ZERO_I80F48;
    for (let i = 0; i < mangoGroup.numOracles; i++) {
      const mgnoAccruedUiVal = nativeI80F48ToUi(
        I80F48.fromI64(this.perpAccounts[i].mngoAccrued).mul(mngoPrice),
        mngoDecimals,
      );

      val = val.add(mgnoAccruedUiVal);
    }

    return val;
  }

  getLeverage(mangoGroup: MangoGroup, mangoCache: MangoCache): I80F48 {
    const liabs = this.getLiabsVal(mangoGroup, mangoCache);
    const assets = this.getAssetsVal(mangoGroup, mangoCache);

    if (assets.gt(ZERO_I80F48)) {
      return liabs.div(assets.sub(liabs));
    }
    return ZERO_I80F48;
  }

  calcTotalPerpUnsettledPnl(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
  ): I80F48 {
    let pnl = ZERO_I80F48;
    for (let i = 0; i < mangoGroup.perpMarkets.length; i++) {
      const perpMarketInfo = mangoGroup.perpMarkets[i];
      if (perpMarketInfo.isEmpty()) continue;

      const price = mangoCache.getPrice(i);
      pnl = pnl.add(
        this.perpAccounts[i].getPnl(
          perpMarketInfo,
          mangoCache.perpMarketCache[i],
          price,
        ),
      );
    }
    return pnl;
  }

  calcTotalPerpPosUnsettledPnl(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
  ): I80F48 {
    let pnl = ZERO_I80F48;
    for (let i = 0; i < mangoGroup.perpMarkets.length; i++) {
      const perpMarketInfo = mangoGroup.perpMarkets[i];
      if (perpMarketInfo.isEmpty()) continue;

      const price = mangoCache.getPrice(i);
      const perpAccountPnl = this.perpAccounts[i].getPnl(
        perpMarketInfo,
        mangoCache.perpMarketCache[i],
        price,
      );
      if (perpAccountPnl.isPos()) {
        pnl = pnl.add(perpAccountPnl);
      }
    }
    return pnl;
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
    let deposits = ZERO_I80F48;
    let borrows = ZERO_I80F48;
    let initLiabWeight, initAssetWeight;

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

    let max = ZERO_I80F48;
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

  isLiquidatable(mangoGroup: MangoGroup, mangoCache: MangoCache): boolean {
    return (
      (this.beingLiquidated &&
        this.getHealth(mangoGroup, mangoCache, 'Init').isNeg()) ||
      this.getHealth(mangoGroup, mangoCache, 'Maint').isNeg()
    );
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
      'Maint Health Ratio: ' +
        this.getHealthRatio(mangoGroup, cache, 'Maint').toFixed(4),
    );
    lines.push(
      'Maint Health: ' + this.getHealth(mangoGroup, cache, 'Maint').toFixed(4),
    );
    lines.push(
      'Init Health: ' + this.getHealth(mangoGroup, cache, 'Init').toFixed(4),
    );
    lines.push('Equity: ' + this.computeValue(mangoGroup, cache).toFixed(4));
    lines.push('isBankrupt: ' + this.isBankrupt);
    lines.push('beingLiquidated: ' + this.beingLiquidated);

    lines.push('Spot:');
    lines.push(
      'Token: Net Balance / Base In Orders / Quote In Orders / Liq. Price',
    );

    const quoteAdj = new BN(10).pow(
      new BN(mangoGroup.tokens[QUOTE_INDEX].decimals),
    );

    for (let i = 0; i < mangoGroup.tokens.length; i++) {
      if (mangoGroup.tokens[i].mint.equals(zeroKey)) {
        continue;
      }
      const token = getTokenByMint(
        groupConfig,
        mangoGroup.tokens[i].mint,
      ) as TokenConfig;

      let baseInOrders = ZERO_BN;
      let quoteInOrders = ZERO_BN;
      const openOrders =
        i !== QUOTE_INDEX ? this.spotOpenOrdersAccounts[i] : undefined;

      if (openOrders) {
        const baseAdj = new BN(10).pow(new BN(mangoGroup.tokens[i].decimals));

        baseInOrders = openOrders.baseTokenTotal.div(baseAdj);
        quoteInOrders = openOrders.quoteTokenTotal
          .add(openOrders['referrerRebatesAccrued'])
          .div(quoteAdj);
      }
      const net = nativeI80F48ToUi(
        this.getNet(cache.rootBankCache[i], i),
        mangoGroup.tokens[i].decimals,
      );

      if (
        net.eq(ZERO_I80F48) &&
        baseInOrders.isZero() &&
        quoteInOrders.isZero()
      ) {
        continue;
      }
      const liqPrice =
        i !== QUOTE_INDEX
          ? this.getLiquidationPrice(mangoGroup, cache, i)
          : undefined;
      const liqPriceStr = liqPrice !== undefined ? liqPrice.toFixed(4) : 'N/A';
      lines.push(
        `${token.symbol}: ${net.toFixed(4)} / ${baseInOrders
          .toNumber()
          .toFixed(4)} / ${quoteInOrders
          .toNumber()
          .toFixed(4)} / ${liqPriceStr}`,
      );
    }

    lines.push('Perps:');
    lines.push(
      'Market: Base Pos / Quote Pos / Unsettled Funding / Health / Liq. Price',
    );

    for (let i = 0; i < this.perpAccounts.length; i++) {
      if (mangoGroup.perpMarkets[i].perpMarket.equals(zeroKey)) {
        continue;
      }
      const market = getMarketByPublicKey(
        groupConfig,
        mangoGroup.perpMarkets[i].perpMarket,
      ) as PerpMarketConfig;
      if (market === undefined) {
        continue;
      }

      const liqPrice = this.getLiquidationPrice(mangoGroup, cache, i);
      const liqPriceStr = liqPrice !== undefined ? liqPrice.toFixed(4) : 'N/A';

      const perpAccount = this.perpAccounts[i];
      const perpMarketInfo = mangoGroup.perpMarkets[i];
      lines.push(
        `${market.name}: ${this.getBasePositionUiWithGroup(
          i,
          mangoGroup,
        ).toFixed(4)} / ${(
          perpAccount.getQuotePosition(cache.perpMarketCache[i]).toNumber() /
          quoteAdj.toNumber()
        ).toFixed(4)} / ${(
          perpAccount.getUnsettledFunding(cache.perpMarketCache[i]).toNumber() /
          quoteAdj.toNumber()
        ).toFixed(4)} / ${perpAccount
          .getHealth(
            perpMarketInfo,
            cache.priceCache[i].price,
            perpMarketInfo.maintAssetWeight,
            perpMarketInfo.maintLiabWeight,
            cache.perpMarketCache[i].longFunding,
            cache.perpMarketCache[i].shortFunding,
          )
          .toFixed(4)} / ${liqPriceStr}`,
      );
    }
    return lines.join(EOL);
  }

  /**
   * Get all the open orders using only info in MangoAccount; Does not contain
   * information about the size of the order.
   */
  getPerpOpenOrders(): { marketIndex: number; price: BN; side: string }[] {
    const perpOpenOrders: { marketIndex: number; price: BN; side: string }[] =
      [];

    for (let i = 0; i < this.orders.length; i++) {
      if (this.orderMarket[i] === FREE_ORDER_SLOT) {
        continue;
      }
      perpOpenOrders.push({
        marketIndex: this.orderMarket[i],
        price: getPriceFromKey(this.orders[i]),
        side: this.orderSide[i],
      });
    }
    return perpOpenOrders;
  }

  /**
   * Return the open orders keys in basket and replace open orders not in basket with zero key
   */
  getOpenOrdersKeysInBasket(): PublicKey[] {
    return this.spotOpenOrders.map((pk, i) =>
      this.inMarginBasket[i] ? pk : zeroKey,
    );
  }
  /**
   * Return the open orders keys in basket; no zero keys; useful for PlaceSpotOrder2 and PlacePerpOrder2
   */
  getOpenOrdersKeysInBasketPacked(): PublicKey[] {
    return this.spotOpenOrders.filter((pk, i) => this.inMarginBasket[i]);
  }

  /**
   *  Return the current position for the market at `marketIndex` in UI units
   *  e.g. if you buy 1 BTC in the UI, you're buying 1,000,000 native BTC,
   *  10,000 BTC-PERP contracts and exactly 1 BTC in UI
   *  Find the marketIndex in the ids.json list of perp markets
   */
  getPerpPositionUi(marketIndex: number, perpMarket: PerpMarket): number {
    return this.perpAccounts[marketIndex].getBasePositionUi(perpMarket);
  }
  /**
   *  Return the current position for the market at `marketIndex` in UI units
   *  e.g. if you buy 1 BTC in the UI, you're buying 1,000,000 native BTC,
   *  10,000 BTC-PERP contracts and exactly 1 BTC in UI
   *  Find the marketIndex in the ids.json list of perp markets
   */
  getBasePositionUiWithGroup(marketIndex: number, group: MangoGroup): number {
    return (
      this.perpAccounts[marketIndex].basePosition
        .mul(group.perpMarkets[marketIndex].baseLotSize)
        .toNumber() / Math.pow(10, group.tokens[marketIndex].decimals)
    );
  }

  /**
   * Return the equity in standard UI numbers. E.g. if equity is $100, this returns 100
   */
  getEquityUi(mangoGroup: MangoGroup, mangoCache: MangoCache): number {
    return (
      this.computeValue(mangoGroup, mangoCache).toNumber() /
      Math.pow(10, mangoGroup.tokens[QUOTE_INDEX].decimals)
    );
  }

  /**
   * This is the init health divided by quote decimals
   */
  getCollateralValueUi(mangoGroup: MangoGroup, mangoCache: MangoCache): number {
    return (
      this.getHealth(mangoGroup, mangoCache, 'Init').toNumber() /
      Math.pow(10, mangoGroup.tokens[QUOTE_INDEX].decimals)
    );
  }

  /**
   * Calculates the exposure for each spot asset and perp contract
   * in standard UI numbers. E.g. if a user has net borrowed $100,
   * and is long 10,000 MNGO contracts this would return:
   * [{asset: "USDC", symbol: "USDC", amount: -100, value: -100},
   *  {asset: "MNGO-PERP", symbol: "MNGO", amount: 10000, value: 2000}]
   * All perp markets that are active for the mango group need to be
   * loaded before calling this method and can passed in arbitrary order.
   */
  getNetExposureByAsset(
    groupConfig: GroupConfig,
    group: MangoGroup,
    perpMarkets: Array<PerpMarket>,
    cache: MangoCache,
  ): Array<{
    asset: string;
    amount: number;
    symbol: string;
    value: number;
  }> {
    // calculate quote balance first
    const quoteBalance = nativeToUi(
      this.getNet(cache.rootBankCache[QUOTE_INDEX], QUOTE_INDEX).toNumber(),
      group.tokens[QUOTE_INDEX].decimals,
    );
    let result = [
      {
        asset: 'USDC',
        amount: quoteBalance,
        symbol: 'USDC',
        value: quoteBalance,
      },
    ];
    const quote = result[0];

    // then for each oracle
    for (let index = 0; index < group.numOracles; ++index) {
      const oracle = groupConfig.oracles[index];
      const price = group.getPrice(index, cache).toNumber();

      // calculate spot margin balance
      if (!group.spotMarkets[index].isEmpty()) {
        let amount = nativeToUi(
          this.getNet(cache.rootBankCache[index], index).toNumber(),
          group.tokens[index].decimals,
        );
        let value = amount * price;

        const openOrdersAccount = this.spotOpenOrdersAccounts[index];
        if (openOrdersAccount !== undefined) {
          // include open orders unsettled base
          const baseAmount = nativeToUi(
            openOrdersAccount.baseTokenTotal.toNumber(),
            group.tokens[index].decimals,
          );

          amount += baseAmount;
          value += baseAmount * price;

          // adjust quote with open orders unsettled quote
          const quoteAmount = nativeToUi(
            openOrdersAccount.quoteTokenTotal.toNumber() +
              openOrdersAccount['referrerRebatesAccrued'].toNumber(),
            group.tokens[QUOTE_INDEX].decimals,
          );
          quote.amount += quoteAmount;
          quote.value += quoteAmount;
        }

        result.push({
          asset: oracle.symbol,
          symbol: oracle.symbol,
          amount,
          value,
        });
      }

      // calculate perp balance
      if (!group.perpMarkets[index].isEmpty()) {
        const marketConfig = groupConfig.perpMarkets.find(
          (p) => p.marketIndex == index,
        )!;
        const market = perpMarkets.find(
          (p) => p?.publicKey == marketConfig?.publicKey,
        )!;

        const amount = this.perpAccounts[index].getBasePositionUi(market);
        const value = price * amount;

        result.push({
          asset: marketConfig.name,
          symbol: oracle.symbol,
          amount,
          value,
        });

        // adjust quote w/ unsettled amount
        const unsettledAmount = nativeToUi(
          this.perpAccounts[index]
            .getPnl(
              group.perpMarkets[index],
              cache.perpMarketCache[index],
              I80F48.fromNumber(price),
            )
            .toNumber(),
          group.tokens[QUOTE_INDEX].decimals,
        );
        quote.amount += unsettledAmount;
        quote.value += unsettledAmount;
      }
    }

    return result;
  }
}

export type HealthType = 'Init' | 'Maint';
