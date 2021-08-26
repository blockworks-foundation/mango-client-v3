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
import { AssetType, MangoCache } from './layout';
import {
  getMultipleAccounts,
  MangoAccount,
  MangoGroup,
  nativeToUi,
  PerpMarket,
  RootBank,
  ZERO_BN,
} from '.';
import { QUOTE_INDEX, MangoAccountLayout } from './layout';
import { Orderbook } from '@project-serum/serum/lib/market';
import axios from 'axios';

const interval = parseInt(process.env.INTERVAL || '3500');
const refreshAccountsInterval = parseInt(process.env.INTERVAL || '60000');
const config = new Config(configFile);

const cluster = (process.env.CLUSTER || 'mainnet') as Cluster;
const groupName = process.env.GROUP || 'mainnet.1';
const groupIds = config.getGroup(cluster, groupName);
if (!groupIds) {
  throw new Error(`Group ${groupName} not found`);
}

const TARGETS = [0, 0, 0, 0, 0, 0, 0];
const blacklist: string[] = [];

const mangoProgramId = groupIds.mangoProgramId;
const mangoGroupKey = groupIds.publicKey;
const payer = new Account(
  JSON.parse(
    process.env.KEYPAIR ||
      fs.readFileSync(
        os.homedir() + '/.config/solana/my-mainnet.json',
        'utf-8',
      ),
  ),
);
console.log(`Payer: ${payer.publicKey.toBase58()}`);
const connection = new Connection(
  config.cluster_urls[cluster],
  'processed' as Commitment,
);
const client = new MangoClient(connection, mangoProgramId);

const liqorMangoAccountKey = new PublicKey('');

let mangoAccounts: MangoAccount[] = [];

async function main() {
  if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
  }
  console.log(`Starting liquidator for ${groupName}...`);
  const liquidating = {};
  let numLiquidating = 0;
  const mangoGroup = await client.getMangoGroup(mangoGroupKey);

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
      const cache = await mangoGroup.loadCache(connection);
      const liqorMangoAccount = await client.getMangoAccount(
        liqorMangoAccountKey,
        mangoGroup.dexProgramId,
      );
      for (let mangoAccount of mangoAccounts) {
        const health = mangoAccount.getHealthRatio(mangoGroup, cache, 'Maint');
        const mangoAccountKeyString = mangoAccount.publicKey.toBase58();
        if (health.lt(ZERO_I80F48)) {
          if (
            !liquidating[mangoAccountKeyString] &&
            numLiquidating < 1 &&
            !blacklist.includes(mangoAccountKeyString)
          ) {
            liquidating[mangoAccountKeyString] = true;
            numLiquidating++;
            console.log(
              `Sick account ${mangoAccountKeyString} health: ${health.toString()}`,
            );
            notify(
              `Sick account ${mangoAccountKeyString} health: ${health.toString()}`,
            );
            console.log(mangoAccount.toPrettyString(mangoGroup, cache));
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
                notify(`Failed to liquidate account ${mangoAccountKeyString}`);
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
  console.log('Watching accounts...');
  const openOrdersAccountSpan = OpenOrders.getLayout(
    mangoGroup.dexProgramId,
  ).span;
  const openOrdersAccountOwnerOffset = OpenOrders.getLayout(
    mangoGroup.dexProgramId,
  ).offsetOf('owner');
  connection.onProgramAccountChange(
    mangoProgramId,
    ({ accountId, accountInfo }) => {
      if (accountInfo.data.length == MangoAccountLayout.span) {
        const mangoAccount = new MangoAccount(
          accountId,
          MangoAccountLayout.decode(accountInfo.data),
        );
        const index = mangoAccounts.findIndex((account) =>
          account.publicKey.equals(mangoAccount.publicKey),
        );

        mangoAccounts[index] = mangoAccount;
        //console.log('Updated account ' + accountId.toBase58());
      }
    },
    'singleGossip',
    [{ dataSize: MangoAccountLayout.span }],
  );
  connection.onProgramAccountChange(
    mangoGroup.dexProgramId,
    ({ accountId, accountInfo }) => {
      if (accountInfo.data.length == openOrdersAccountSpan) {
        const ownerIndex = mangoAccounts.findIndex((account) =>
          account.spotOpenOrders.some((key) => key.equals(accountId)),
        );

        if (ownerIndex > -1) {
          mangoAccounts[ownerIndex].spotOpenOrdersAccounts.forEach((oo, i) => {
            if (oo && oo.address.equals(accountId)) {
              mangoAccounts[ownerIndex].spotOpenOrdersAccounts[i] =
                OpenOrders.fromAccountInfo(
                  accountId,
                  accountInfo,
                  mangoGroup.dexProgramId,
                );
              // console.log(
              //   'Updated OpenOrders for account ' + accountId.toBase58(),
              // );
            }
          });
        } else {
          console.error('Could not match OpenOrdersAccount to MangoAccount');
        }
      }
    },
    'singleGossip',
    [
      {
        memcmp: {
          offset: openOrdersAccountOwnerOffset,
          bytes: mangoGroup.signerKey.toBase58(),
        },
      },
    ],
  );
}

async function refreshAccounts(mangoGroup: MangoGroup) {
  try {
    console.log('Refreshing accounts...');
    console.time('getAllMangoAccounts');
    mangoAccounts = await client.getAllMangoAccounts(
      mangoGroup,
      undefined,
      true,
    );
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
  await liqee.reload(connection);

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
    const spotMarketInfo = mangoGroup.spotMarkets[i];

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
    const maxLiabTransfer = liqee.getNativeBorrow(liabRootBank, minNetIndex);
    if (liqee.isBankrupt) {
      console.log('Bankrupt account', liqee.publicKey.toBase58());
      const quoteRootBank = rootBanks[QUOTE_INDEX];
      const maxLiabTransfer = liqee.getNativeBorrow(liabRootBank, minNetIndex);
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
        liqee = await liqee.reload(connection);
      }
    } else {
      await client.liquidateTokenAndToken(
        mangoGroup,
        liqee,
        liqor,
        assetRootBank,
        liabRootBank,
        payer,
        maxLiabTransfer,
      );

      liqee = await liqee.reload(connection);
      if (liqee.isBankrupt) {
        console.log('Bankrupt account', liqee.publicKey.toBase58());
        const quoteRootBank = rootBanks[QUOTE_INDEX];
        const maxLiabTransfer = liqee.getNativeBorrow(
          liabRootBank,
          minNetIndex,
        );
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
          liqee = await liqee.reload(connection);
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
      const price = mangoGroup.getPrice(marketIndex, cache);
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
      await liqee.reload(connection);
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
    await liqee.reload(connection);
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
      await liqee.reload(connection);
    }

    await closePositions(mangoGroup, liqor, perpMarkets);
  }
}

async function balanceTokens(
  mangoGroup: MangoGroup,
  mangoAccount: MangoAccount,
  markets: Market[],
) {
  console.log('balanceTokens');
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

    for (let order of orders) {
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
  console.log('cancelling ' + cancelOrdersPromises.length + ' orders');
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
  console.log('settling on ' + settlePromises.length + ' markets');
  await Promise.all(settlePromises);

  const diffs: I80F48[] = [];
  const netValues: [number, I80F48][] = [];
  // Go to each base currency and see if it's above or below target

  for (let i = 0; i < groupIds!.spotMarkets.length; i++) {
    const diff = mangoAccount
      .getUiDeposit(cache.rootBankCache[i], mangoGroup, i)
      .sub(I80F48.fromNumber(TARGETS[i]));
    diffs.push(diff);
    netValues.push([i, diff.mul(cache.priceCache[i].price)]);
  }

  netValues.sort((a, b) => b[1].sub(a[1]).toNumber());
  for (let i = 0; i < groupIds!.spotMarkets.length; i++) {
    const marketIndex = netValues[i][0];
    const market = markets[marketIndex];

    if (netValues[i][1].gt(ZERO_I80F48)) {
      // sell to close
      const price = cache.priceCache[marketIndex].price.mul(
        I80F48.fromNumber(0.95),
      );
      console.log(
        `Sell to close ${marketIndex} ${diffs[
          marketIndex
        ].toString()} @ ${price.toString()}`,
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
      // buy to close
      const price = cache.priceCache[marketIndex].price.mul(
        I80F48.fromNumber(1.05),
      );

      console.log(
        `Buy to close ${marketIndex} ${diffs[
          marketIndex
        ].toString()} @ ${price.toString()}`,
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

async function closePositions(
  mangoGroup: MangoGroup,
  mangoAccount: MangoAccount,
  perpMarkets: PerpMarket[],
) {
  console.log('closePositions');
  const cache = await mangoGroup.loadCache(connection);
  for (let i = 0; i < mangoAccount.perpAccounts.length; i++) {
    const perpAccount = mangoAccount.perpAccounts[i];
    const perpMarket = perpMarkets[i];
    if (perpMarket && perpAccount) {
      const positionSize = Math.abs(
        perpMarket.baseLotsToNumber(perpAccount.basePosition),
      );
      if (positionSize != 0) {
        const side = perpAccount.basePosition.gt(ZERO_BN) ? 'sell' : 'buy';
        const liquidationFee =
          mangoGroup.perpMarkets[i].liquidationFee.toNumber();
        const price = cache.priceCache[i].price;
        const orderPrice =
          side == 'sell' ? price.toNumber() * 0.95 : price.toNumber() * 1.05; // TODO: base this on liquidation fee

        console.log(
          side +
            'ing ' +
            positionSize +
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
          positionSize,
          'ioc',
        );

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
}

function notify(content: string) {
  axios.post(
    'https://discord.com/api/webhooks/879503355205005353/2Uy1p-HISWLXKi90frExr2_rr7uqBFjswupUhUFctuWIhzPwjPpQJadlK22WGEGZSOiy',
    { content },
  );
}

main();
