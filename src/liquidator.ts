/**
 This will probably move to its own repo at some point but easier to keep it here for now
 */
import * as os from 'os';
import * as fs from 'fs';
import { MangoClient } from './client';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import { sleep } from './utils';
import configFile from './ids.json';
import { Cluster, Config } from './config';
import { I80F48, ONE_I80F48, ZERO_I80F48 } from './fixednum';
import { Market, OpenOrders } from '@project-serum/serum';
import BN from 'bn.js';
import { MangoAccountLayout, MangoCache, QUOTE_INDEX } from './layout';
import {
  AssetType,
  getMultipleAccounts,
  MangoAccount,
  MangoGroup,
  PerpMarket,
  RootBank,
  zeroKey,
  ZERO_BN,
} from '.';
import { Orderbook } from '@project-serum/serum/lib/market';
import axios from 'axios';
import * as Env from 'dotenv';
import envExpand from 'dotenv-expand';

envExpand(Env.config());

const interval = parseInt(process.env.INTERVAL || '3500');
const refreshAccountsInterval = parseInt(
  process.env.INTERVAL_ACCOUNTS || '120000',
);
const refreshWebsocketInterval = parseInt(
  process.env.INTERVAL_WEBSOCKET || '300000',
);
const config = new Config(configFile);

const cluster = (process.env.CLUSTER || 'mainnet') as Cluster;
const groupName = process.env.GROUP || 'mainnet.1';
const groupIds = config.getGroup(cluster, groupName);
if (!groupIds) {
  throw new Error(`Group ${groupName} not found`);
}

const TARGETS = process.env.TARGETS
  ? process.env.TARGETS.split(' ').map((s) => parseFloat(s))
  : [0, 0, 0, 0, 0, 0, 0, 0, 0];

const mangoProgramId = groupIds.mangoProgramId;
const mangoGroupKey = groupIds.publicKey;

const payer = new Account(
  JSON.parse(
    fs.readFileSync(
      process.env.KEYPAIR || os.homedir() + '/.config/solana/id.json',
      'utf-8',
    ),
  ),
);
console.log(`Payer: ${payer.publicKey.toBase58()}`);

const connection = new Connection(
  process.env.ENDPOINT_URL || config.cluster_urls[cluster],
  'processed' as Commitment,
);
const client = new MangoClient(connection, mangoProgramId);

let mangoAccounts: MangoAccount[] = [];

let mangoSubscriptionId = -1;
let dexSubscriptionId = -1;

async function main() {
  if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
  }
  console.log(`Starting liquidator for ${groupName}...`);
  const liquidating = {};
  let numLiquidating = 0;
  const mangoGroup = await client.getMangoGroup(mangoGroupKey);
  let cache = await mangoGroup.loadCache(connection);
  let liqorMangoAccount: MangoAccount;

  if (process.env.LIQOR_PK) {
    liqorMangoAccount = await client.getMangoAccount(
      new PublicKey(process.env.LIQOR_PK),
      mangoGroup.dexProgramId,
    );
    if (!liqorMangoAccount.owner.equals(payer.publicKey)) {
      throw new Error('Account not owned by Keypair');
    }
  } else {
    const accounts = await client.getMangoAccountsForOwner(
      mangoGroup,
      payer.publicKey,
      true,
    );
    if (accounts.length) {
      accounts.sort((a, b) =>
        b
          .computeValue(mangoGroup, cache)
          .sub(a.computeValue(mangoGroup, cache))
          .toNumber(),
      );
      liqorMangoAccount = accounts[0];
    } else {
      throw new Error('No Mango Account found for this Keypair');
    }
  }

  console.log(`Liqor Public Key: ${liqorMangoAccount.publicKey.toBase58()}`);

  await refreshAccounts(mangoGroup);
  watchAccounts(groupIds.mangoProgramId, mangoGroup);
  const perpMarkets = await Promise.all(
    groupIds.perpMarkets.map((perpMarket) => {
      return mangoGroup.loadPerpMarket(
        connection,
        perpMarket.marketIndex,
        perpMarket.baseDecimals,
        perpMarket.quoteDecimals,
      );
    }),
  );
  const spotMarkets = await Promise.all(
    groupIds.spotMarkets.map((spotMarket) => {
      return Market.load(
        connection,
        spotMarket.publicKey,
        undefined,
        groupIds.serumProgramId,
      );
    }),
  );
  const rootBanks = await mangoGroup.loadRootBanks(connection);
  notify(`V3 Liquidator launched for group ${groupName}`);

  // eslint-disable-next-line
  while (true) {
    try {
      cache = await mangoGroup.loadCache(connection);
      await liqorMangoAccount.reload(connection);

      for (const mangoAccount of mangoAccounts) {
        const health = mangoAccount.getHealthRatio(mangoGroup, cache, 'Maint');
        const mangoAccountKeyString = mangoAccount.publicKey.toBase58();
        if (process.env.CHECK_TRIGGERS) {
          try {
            if (
              mangoAccount.advancedOrdersKey &&
              !mangoAccount.advancedOrdersKey.equals(zeroKey)
            ) {
              await mangoAccount.loadAdvancedOrders(connection);
              if (mangoAccount.advancedOrders) {
                for (let i = 0; i < mangoAccount.advancedOrders.length; i++) {
                  const order = mangoAccount.advancedOrders[i];
                  if (
                    order.perpTrigger &&
                    order.perpTrigger.isActive &&
                    order.perpTrigger['reduceOnly'] == true
                  ) {
                    const trigger = order.perpTrigger;
                    const currentPrice =
                      cache.priceCache[trigger.marketIndex].price;
                    const marketIndex = groupIds.perpMarkets.findIndex(
                      (pm) => pm.marketIndex == trigger.marketIndex,
                    );
                    if (
                      (trigger.triggerCondition == 'above' &&
                        currentPrice.gt(trigger.triggerPrice)) ||
                      (trigger.triggerCondition == 'below' &&
                        currentPrice.lt(trigger.triggerPrice))
                    ) {
                      console.log(
                        `Executing order for account ${mangoAccount.publicKey.toBase58()}`,
                      );
                      await client.executePerpTriggerOrder(
                        mangoGroup,
                        mangoAccount,
                        cache,
                        perpMarkets[marketIndex],
                        payer,
                        i,
                      );
                    }
                  }
                }
              }
            }
          } catch (err) {
            console.error(
              `Failed to execute trigger order for ${mangoAccountKeyString}`,
              err,
            );
          }
        }
        if (health.lt(ZERO_I80F48)) {
          if (!liquidating[mangoAccountKeyString] && numLiquidating < 1) {
            await mangoAccount.reload(connection, mangoGroup.dexProgramId);
            if (
              !mangoAccount
                .getHealthRatio(mangoGroup, cache, 'Maint')
                .lt(ZERO_I80F48)
            ) {
              console.log(
                `Account ${mangoAccountKeyString} no longer liquidatable`,
              );
              continue;
            }

            liquidating[mangoAccountKeyString] = true;
            numLiquidating++;
            console.log(
              `Sick account ${mangoAccountKeyString} health: ${health.toString()}`,
            );
            notify(
              `Sick account ${mangoAccountKeyString} health: ${health.toString()}`,
            );
            console.log(
              mangoAccount.toPrettyString(groupIds, mangoGroup, cache),
            );
            liquidateAccount(
              mangoGroup,
              cache,
              spotMarkets,
              rootBanks,
              perpMarkets,
              mangoAccount,
              liqorMangoAccount,
            )
              .then(() => {
                console.log('Liquidated account', mangoAccountKeyString);
                notify(`Liquidated account ${mangoAccountKeyString}`);
              })
              .catch((err) => {
                console.error(
                  'Failed to liquidate account',
                  mangoAccountKeyString,
                  err,
                );
                notify(
                  `Failed to liquidate account ${mangoAccountKeyString}: ${err}`,
                );
              })
              .finally(() => {
                liquidating[mangoAccountKeyString] = false;
                numLiquidating--;
              });
          }
        }
      }
      await sleep(interval);
    } catch (err) {
      console.error('Error checking accounts:', err);
    }
  }
}

function watchAccounts(mangoProgramId: PublicKey, mangoGroup: MangoGroup) {
  try {
    console.log('Watching accounts...');
    const openOrdersAccountSpan = OpenOrders.getLayout(
      mangoGroup.dexProgramId,
    ).span;
    const openOrdersAccountOwnerOffset = OpenOrders.getLayout(
      mangoGroup.dexProgramId,
    ).offsetOf('owner');

    if (mangoSubscriptionId != -1) {
      connection.removeProgramAccountChangeListener(mangoSubscriptionId);
    }
    if (dexSubscriptionId != -1) {
      connection.removeProgramAccountChangeListener(dexSubscriptionId);
    }

    mangoSubscriptionId = connection.onProgramAccountChange(
      mangoProgramId,
      ({ accountId, accountInfo }) => {
        const mangoAccount = new MangoAccount(
          accountId,
          MangoAccountLayout.decode(accountInfo.data),
        );
        const index = mangoAccounts.findIndex((account) =>
          account.publicKey.equals(mangoAccount.publicKey),
        );

        if (index == -1) {
          //console.log('New Account');
          mangoAccounts.push(mangoAccount);
        } else {
          mangoAccounts[index] = mangoAccount;
          //console.log('Updated account ' + accountId.toBase58());
        }
      },
      'singleGossip',
      [
        { dataSize: MangoAccountLayout.span },
        {
          memcmp: {
            offset: MangoAccountLayout.offsetOf('mangoGroup'),
            bytes: mangoGroup.publicKey.toBase58(),
          },
        },
      ],
    );

    dexSubscriptionId = connection.onProgramAccountChange(
      mangoGroup.dexProgramId,
      ({ accountId, accountInfo }) => {
        const ownerIndex = mangoAccounts.findIndex((account) =>
          account.spotOpenOrders.some((key) => key.equals(accountId)),
        );

        if (ownerIndex > -1) {
          const openOrdersIndex = mangoAccounts[
            ownerIndex
          ].spotOpenOrders.findIndex((key) => key.equals(accountId));
          const openOrders = OpenOrders.fromAccountInfo(
            accountId,
            accountInfo,
            mangoGroup.dexProgramId,
          );
          mangoAccounts[ownerIndex].spotOpenOrdersAccounts[openOrdersIndex] =
            openOrders;
          //console.log('Updated OpenOrders for account ' + mangoAccounts[ownerIndex].publicKey.toBase58());
        } else {
          console.error('Could not match OpenOrdersAccount to MangoAccount');
        }
      },
      'singleGossip',
      [
        { dataSize: openOrdersAccountSpan },
        {
          memcmp: {
            offset: openOrdersAccountOwnerOffset,
            bytes: mangoGroup.signerKey.toBase58(),
          },
        },
      ],
    );
  } catch (err) {
    console.error('Error watching accounts', err);
  } finally {
    setTimeout(
      watchAccounts,
      refreshWebsocketInterval,
      mangoProgramId,
      mangoGroup,
    );
  }
}

async function refreshAccounts(mangoGroup: MangoGroup) {
  try {
    console.log('Refreshing accounts...');
    console.time('getAllMangoAccounts');
    mangoAccounts = await client.getAllMangoAccounts(mangoGroup);
    console.timeEnd('getAllMangoAccounts');
    console.log(`Fetched ${mangoAccounts.length} accounts`);
  } catch (err) {
    console.error('Error reloading accounts', err);
  } finally {
    setTimeout(refreshAccounts, refreshAccountsInterval, mangoGroup);
  }
}

async function liquidateAccount(
  mangoGroup: MangoGroup,
  cache: MangoCache,
  spotMarkets: Market[],
  rootBanks: (RootBank | undefined)[],
  perpMarkets: PerpMarket[],
  liqee: MangoAccount,
  liqor: MangoAccount,
) {
  const hasPerpOpenOrders = liqee.perpAccounts.some(
    (pa) => pa.bidsQuantity.gt(ZERO_BN) || pa.asksQuantity.gt(ZERO_BN),
  );

  if (hasPerpOpenOrders) {
    console.log('forceCancelPerpOrders');
    await Promise.all(
      perpMarkets.map((perpMarket) => {
        return client.forceCancelAllPerpOrdersInMarket(
          mangoGroup,
          liqee,
          perpMarket,
          payer,
          10,
        );
      }),
    );
    await sleep(interval * 2);
  }
  await liqee.reload(connection, mangoGroup.dexProgramId);
  if (!liqee.getHealthRatio(mangoGroup, cache, 'Maint').lt(ZERO_I80F48)) {
    throw new Error('Account no longer liquidatable');
  }

  const healthComponents = liqee.getHealthComponents(mangoGroup, cache);
  const healths = liqee.getHealthsFromComponents(
    mangoGroup,
    cache,
    healthComponents.spot,
    healthComponents.perps,
    healthComponents.quote,
    'Maint',
  );

  let shouldLiquidateSpot = false;
  for (let i = 0; i < mangoGroup.tokens.length; i++) {
    const price = cache.priceCache[i] ? cache.priceCache[i].price : ONE_I80F48;
    if (
      liqee
        .getNativeDeposit(cache.rootBankCache[i], i)
        .sub(liqee.getNativeBorrow(cache.rootBankCache[i], i))
        .mul(price)
        .lt(ZERO_I80F48)
    ) {
      shouldLiquidateSpot = true;
    }
  }

  if (shouldLiquidateSpot) {
    await liquidateSpot(
      mangoGroup,
      cache,
      spotMarkets,
      rootBanks,
      liqee,
      liqor,
    );
  }
  if (healths.perp.lt(ZERO_I80F48)) {
    await liquidatePerps(
      mangoGroup,
      cache,
      perpMarkets,
      rootBanks,
      liqee,
      liqor,
    );
  }
}

async function liquidateSpot(
  mangoGroup: MangoGroup,
  cache: MangoCache,
  spotMarkets: Market[],
  rootBanks: (RootBank | undefined)[],
  liqee: MangoAccount,
  liqor: MangoAccount,
) {
  console.log('liquidateSpot');

  for (let i = 0; i < mangoGroup.spotMarkets.length; i++) {
    const spotMarket = spotMarkets[i];
    const baseRootBank = rootBanks[i];
    const quoteRootBank = rootBanks[QUOTE_INDEX];

    if (baseRootBank && quoteRootBank) {
      if (liqee.inMarginBasket[i]) {
        console.log('forceCancelOrders ', i);
        await client.forceCancelSpotOrders(
          mangoGroup,
          liqee,
          spotMarket,
          baseRootBank,
          quoteRootBank,
          payer,
          new BN(5),
        );
        await sleep(interval);
      }
    }
  }

  let minNet = ZERO_I80F48;
  let minNetIndex = -1;
  let maxNet = ZERO_I80F48;
  let maxNetIndex = QUOTE_INDEX;

  for (let i = 0; i < mangoGroup.tokens.length; i++) {
    const price = cache.priceCache[i] ? cache.priceCache[i].price : ONE_I80F48;
    const netDeposit = liqee
      .getNativeDeposit(cache.rootBankCache[i], i)
      .sub(liqee.getNativeBorrow(cache.rootBankCache[i], i))
      .mul(price);

    if (netDeposit.lt(minNet)) {
      minNet = netDeposit;
      minNetIndex = i;
    } else if (netDeposit.gt(maxNet)) {
      maxNet = netDeposit;
      maxNetIndex = i;
    }
  }
  if (minNetIndex == -1) {
    throw new Error('min net index neg 1');
  }

  if (minNetIndex == maxNetIndex) {
    maxNetIndex = 0;
  }

  const liabRootBank = rootBanks[minNetIndex];
  const assetRootBank = rootBanks[maxNetIndex];

  if (assetRootBank && liabRootBank) {
    const liqorInitHealth = liqor.getHealth(mangoGroup, cache, 'Init');
    const liabAssetWeight = mangoGroup.spotMarkets[minNetIndex]
      ? mangoGroup.spotMarkets[minNetIndex].initAssetWeight
      : ONE_I80F48;
    const assetAssetWeight = mangoGroup.spotMarkets[maxNetIndex]
      ? mangoGroup.spotMarkets[maxNetIndex].initAssetWeight
      : ONE_I80F48;
    const maxLiabTransfer = liqorInitHealth.div(
      mangoGroup
        .getPriceNative(minNetIndex, cache)
        .mul(liabAssetWeight.sub(assetAssetWeight).abs()),
    );

    if (liqee.isBankrupt) {
      console.log('Bankrupt account', liqee.publicKey.toBase58());
      const quoteRootBank = rootBanks[QUOTE_INDEX];
      if (quoteRootBank) {
        await client.resolveTokenBankruptcy(
          mangoGroup,
          liqee,
          liqor,
          quoteRootBank,
          liabRootBank,
          payer,
          maxLiabTransfer,
        );
        await liqee.reload(connection, mangoGroup.dexProgramId);
      }
    } else {
      console.log(
        `Liquidating max ${maxLiabTransfer.toString()}/${liqee.getNativeBorrow(
          liabRootBank,
          minNetIndex,
        )} of liab ${minNetIndex}, asset ${maxNetIndex}`,
      );
      await client.liquidateTokenAndToken(
        mangoGroup,
        liqee,
        liqor,
        assetRootBank,
        liabRootBank,
        payer,
        maxLiabTransfer,
      );

      await liqee.reload(connection, mangoGroup.dexProgramId);
      if (liqee.isBankrupt) {
        console.log('Bankrupt account', liqee.publicKey.toBase58());
        const quoteRootBank = rootBanks[QUOTE_INDEX];
        if (quoteRootBank) {
          await client.resolveTokenBankruptcy(
            mangoGroup,
            liqee,
            liqor,
            quoteRootBank,
            liabRootBank,
            payer,
            maxLiabTransfer,
          );
          await liqee.reload(connection, mangoGroup.dexProgramId);
        }
      }
    }
    await balanceTokens(mangoGroup, liqor, spotMarkets);
  }
}

async function liquidatePerps(
  mangoGroup: MangoGroup,
  cache: MangoCache,
  perpMarkets: PerpMarket[],
  rootBanks: (RootBank | undefined)[],
  liqee: MangoAccount,
  liqor: MangoAccount,
) {
  console.log('liquidatePerps');
  const lowestHealthMarket = perpMarkets
    .map((perpMarket, i) => {
      const marketIndex = mangoGroup.getPerpMarketIndex(perpMarket.publicKey);
      const perpMarketInfo = mangoGroup.perpMarkets[marketIndex];
      const perpAccount = liqee.perpAccounts[marketIndex];
      const perpMarketCache = cache.perpMarketCache[marketIndex];
      const price = mangoGroup.getPriceNative(marketIndex, cache);
      const perpHealth = perpAccount.getHealth(
        perpMarketInfo,
        price,
        perpMarketInfo.maintAssetWeight,
        perpMarketInfo.maintLiabWeight,
        perpMarketCache.longFunding,
        perpMarketCache.shortFunding,
      );
      return { perpHealth: perpHealth, marketIndex: marketIndex, i };
    })
    .sort((a, b) => {
      return a.perpHealth.sub(b.perpHealth).toNumber();
    })[0];

  if (!lowestHealthMarket) {
    throw new Error('Couldnt find a perp market to liquidate');
  }

  const marketIndex = lowestHealthMarket.marketIndex;
  const perpAccount = liqee.perpAccounts[marketIndex];
  const perpMarket = perpMarkets[lowestHealthMarket.i];
  const baseRootBank = rootBanks[marketIndex];

  if (!baseRootBank) {
    throw new Error(`Base root bank not found for ${marketIndex}`);
  }

  if (!perpMarket) {
    throw new Error(`Perp market not found for ${marketIndex}`);
  }

  if (liqee.isBankrupt) {
    const maxLiabTransfer = I80F48.fromNumber(
      Math.max(Math.abs(perpAccount.quotePosition.toNumber()), 1),
    );

    const quoteRootBank = rootBanks[QUOTE_INDEX];
    if (quoteRootBank) {
      console.log('resolvePerpBankruptcy', maxLiabTransfer.toString());
      await client.resolvePerpBankruptcy(
        mangoGroup,
        liqee,
        liqor,
        perpMarket,
        quoteRootBank!,
        payer,
        marketIndex,
        maxLiabTransfer,
      );
      await liqee.reload(connection, mangoGroup.dexProgramId);
      return;
    }
  }

  if (lowestHealthMarket.perpHealth.lte(ZERO_I80F48)) {
    let maxNet = ZERO_I80F48;
    let maxNetIndex = mangoGroup.tokens.length - 1;

    for (let i = 0; i < mangoGroup.tokens.length; i++) {
      const price = cache.priceCache[i]
        ? cache.priceCache[i].price
        : ONE_I80F48;

      const netDeposit = liqee
        .getNativeDeposit(cache.rootBankCache[i], i)
        .sub(liqee.getNativeBorrow(cache.rootBankCache[i], i))
        .mul(price);

      if (netDeposit.gt(maxNet)) {
        maxNet = netDeposit;
        maxNetIndex = i;
      }
    }

    const assetRootBank = rootBanks[maxNetIndex];

    if (perpAccount.basePosition.eq(new BN(0))) {
      if (assetRootBank) {
        console.log('liquidateTokenAndPerp ' + marketIndex);
        await client.liquidateTokenAndPerp(
          mangoGroup,
          liqee,
          liqor,
          assetRootBank,
          payer,
          AssetType.Token,
          maxNetIndex,
          AssetType.Perp,
          marketIndex,
          maxNet.sub(ONE_I80F48).max(ONE_I80F48),
        );
      }
    } else {
      console.log('liquidatePerpMarket ' + marketIndex);
      const baseTransferRequest = perpAccount.basePosition;
      await client.liquidatePerpMarket(
        mangoGroup,
        liqee,
        liqor,
        perpMarket,
        payer,
        baseTransferRequest,
      );
    }
    await sleep(interval);
    await liqee.reload(connection, mangoGroup.dexProgramId);
    if (liqee.isBankrupt) {
      const maxLiabTransfer = I80F48.fromNumber(
        Math.abs(liqee.perpAccounts[marketIndex].quotePosition.toNumber()),
      );

      const quoteRootBank = rootBanks[QUOTE_INDEX];
      if (quoteRootBank) {
        console.log('resolvePerpBankruptcy', maxLiabTransfer.toString());
        await client.resolvePerpBankruptcy(
          mangoGroup,
          liqee,
          liqor,
          perpMarket,
          quoteRootBank,
          payer,
          marketIndex,
          maxLiabTransfer,
        );
      }
      await liqee.reload(connection, mangoGroup.dexProgramId);
    }

    await closePositions(mangoGroup, liqor, perpMarkets);
  }
}

function getDiffsAndNet(
  mangoGroup: MangoGroup,
  mangoAccount: MangoAccount,
  cache: MangoCache,
) {
  const diffs: I80F48[] = [];
  const netValues: [number, I80F48][] = [];
  // Go to each base currency and see if it's above or below target

  for (let i = 0; i < groupIds!.spotMarkets.length; i++) {
    const target = TARGETS[i] !== undefined ? TARGETS[i] : 0;
    const diff = mangoAccount
      .getUiDeposit(cache.rootBankCache[i], mangoGroup, i)
      .sub(mangoAccount.getUiBorrow(cache.rootBankCache[i], mangoGroup, i))
      .sub(I80F48.fromNumber(target));
    diffs.push(diff);
    netValues.push([i, diff.mul(cache.priceCache[i].price)]);
  }

  return { diffs, netValues };
}

async function balanceTokens(
  mangoGroup: MangoGroup,
  mangoAccount: MangoAccount,
  markets: Market[],
) {
  console.log('balanceTokens');
  await mangoAccount.reload(connection, mangoGroup.dexProgramId);
  const cache = await mangoGroup.loadCache(connection);
  const cancelOrdersPromises: Promise<string>[] = [];
  const bidsInfo = await getMultipleAccounts(
    connection,
    markets.map((m) => m.bidsAddress),
  );
  const bids = bidsInfo
    ? bidsInfo.map((o, i) => Orderbook.decode(markets[i], o.accountInfo.data))
    : [];
  const asksInfo = await getMultipleAccounts(
    connection,
    markets.map((m) => m.asksAddress),
  );
  const asks = asksInfo
    ? asksInfo.map((o, i) => Orderbook.decode(markets[i], o.accountInfo.data))
    : [];

  for (let i = 0; i < markets.length; i++) {
    const orders = [...bids[i], ...asks[i]].filter((o) =>
      o.openOrdersAddress.equals(mangoAccount.spotOpenOrders[i]),
    );

    for (const order of orders) {
      cancelOrdersPromises.push(
        client.cancelSpotOrder(
          mangoGroup,
          mangoAccount,
          payer,
          markets[i],
          order,
        ),
      );
    }
  }
  console.log('Cancelling ' + cancelOrdersPromises.length + ' orders');
  await Promise.all(cancelOrdersPromises);

  const openOrders = await mangoAccount.loadOpenOrders(
    connection,
    mangoGroup.dexProgramId,
  );
  const settlePromises: Promise<string>[] = [];
  for (let i = 0; i < markets.length; i++) {
    const oo = openOrders[i];
    if (
      oo &&
      (oo.quoteTokenTotal.add(oo['referrerRebatesAccrued']).gt(new BN(0)) ||
        oo.baseTokenTotal.gt(new BN(0)))
    ) {
      settlePromises.push(
        client.settleFunds(mangoGroup, mangoAccount, payer, markets[i]),
      );
    }
  }
  console.log('Settling on ' + settlePromises.length + ' markets');
  await Promise.all(settlePromises);

  const { diffs, netValues } = getDiffsAndNet(mangoGroup, mangoAccount, cache);

  netValues.sort((a, b) => b[1].sub(a[1]).toNumber());
  for (let i = 0; i < groupIds!.spotMarkets.length; i++) {
    const marketIndex = netValues[i][0];
    const market = markets[marketIndex];
    if (Math.abs(diffs[marketIndex].toNumber()) > market.minOrderSize) {
      if (netValues[i][1].gt(ZERO_I80F48)) {
        // sell to close
        const price = mangoGroup
          .getPrice(marketIndex, cache)
          .mul(I80F48.fromNumber(0.95));
        console.log(
          `Sell to close ${marketIndex} ${Math.abs(
            diffs[marketIndex].toNumber(),
          )} @ ${price.toString()}`,
        );
        await client.placeSpotOrder(
          mangoGroup,
          mangoAccount,
          mangoGroup.mangoCache,
          markets[marketIndex],
          payer,
          'sell',
          price.toNumber(),
          Math.abs(diffs[marketIndex].toNumber()),
          'ioc',
        );
        await client.settleFunds(
          mangoGroup,
          mangoAccount,
          payer,
          markets[marketIndex],
        );
      } else if (netValues[i][1].lt(ZERO_I80F48)) {
        //buy to close
        const price = mangoGroup
          .getPrice(marketIndex, cache)
          .mul(I80F48.fromNumber(1.05));

        console.log(
          `Buy to close ${marketIndex} ${Math.abs(
            diffs[marketIndex].toNumber(),
          )} @ ${price.toString()}`,
        );
        await client.placeSpotOrder(
          mangoGroup,
          mangoAccount,
          mangoGroup.mangoCache,
          markets[marketIndex],
          payer,
          'buy',
          price.toNumber(),
          Math.abs(diffs[marketIndex].toNumber()),
          'ioc',
        );
        await client.settleFunds(
          mangoGroup,
          mangoAccount,
          payer,
          markets[marketIndex],
        );
      }
    }
  }
  await sleep(2000);
  await mangoAccount.reload(connection, mangoGroup.dexProgramId);

  const { diffs: postDiffs, netValues: postNetValues } = getDiffsAndNet(
    mangoGroup,
    mangoAccount,
    cache,
  );
  const isUnbalanced = postNetValues.some(
    (nv) => Math.abs(postDiffs[nv[0]].toNumber()) > markets[nv[0]].minOrderSize,
  );

  if (isUnbalanced) {
    await balanceTokens(mangoGroup, mangoAccount, markets);
  }
}

async function closePositions(
  mangoGroup: MangoGroup,
  mangoAccount: MangoAccount,
  perpMarkets: PerpMarket[],
) {
  console.log('closePositions');
  await mangoAccount.reload(connection, mangoGroup.dexProgramId);
  const cache = await mangoGroup.loadCache(connection);

  for (let i = 0; i < perpMarkets.length; i++) {
    const perpMarket = perpMarkets[i];
    const index = mangoGroup.getPerpMarketIndex(perpMarket.publicKey);
    const perpAccount = mangoAccount.perpAccounts[index];

    if (perpMarket && perpAccount) {
      const openOrders = await perpMarket.loadOrdersForAccount(
        connection,
        mangoAccount,
      );

      for (const oo of openOrders) {
        await client.cancelPerpOrder(
          mangoGroup,
          mangoAccount,
          payer,
          perpMarket,
          oo,
        );
      }

      const basePositionSize = Math.abs(
        perpMarket.baseLotsToNumber(perpAccount.basePosition),
      );
      const price = cache.priceCache[index].price;

      if (basePositionSize != 0) {
        const side = perpAccount.basePosition.gt(ZERO_BN) ? 'sell' : 'buy';
        const liquidationFee =
          mangoGroup.perpMarkets[index].liquidationFee.toNumber();

        const orderPrice =
          side == 'sell' ? price.toNumber() * 0.95 : price.toNumber() * 1.05; // TODO: base this on liquidation fee

        console.log(
          side +
            'ing ' +
            basePositionSize +
            ' of perp ' +
            i +
            ' for $' +
            orderPrice,
        );
        await client.placePerpOrder(
          mangoGroup,
          mangoAccount,
          cache.publicKey,
          perpMarket,
          payer,
          side,
          orderPrice,
          basePositionSize,
          'ioc',
        );
      }

      await mangoAccount.reload(connection, mangoGroup.dexProgramId);

      if (!perpAccount.quotePosition.eq(ZERO_I80F48)) {
        const quoteRootBank = mangoGroup.rootBankAccounts[QUOTE_INDEX];
        if (quoteRootBank) {
          await client.settlePnl(
            mangoGroup,
            cache,
            mangoAccount,
            perpMarket,
            quoteRootBank,
            price,
            payer,
          );
        }
      }
    }
  }

  await sleep(2000);
  await mangoAccount.reload(connection, mangoGroup.dexProgramId);

  // Check if we need to balance again
  const isUnbalanced = perpMarkets.some((pm) => {
    const index = mangoGroup.getPerpMarketIndex(pm.publicKey);
    const perpAccount = mangoAccount.perpAccounts[index];
    const basePositionSize = Math.abs(
      pm.baseLotsToNumber(perpAccount.basePosition),
    );

    return basePositionSize != 0;
  });

  if (isUnbalanced) {
    await closePositions(mangoGroup, mangoAccount, perpMarkets);
  }
}

function notify(content: string) {
  if (content && process.env.WEBHOOK_URL) {
    try {
      axios.post(process.env.WEBHOOK_URL, { content });
    } catch (err) {
      console.error('Error posting to notify webhook:', err);
    }
  }
}

main();
