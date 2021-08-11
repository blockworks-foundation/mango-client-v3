/**
This will probably move to its own repo at some point but easier to keep it here for now
 */
import * as os from 'os';
import * as fs from 'fs';
import { MangoClient } from './client';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import { sleep, uiToNative } from './utils';
import configFile from './ids.json';
import { Cluster, Config } from './config';
import { I80F48, ONE_I80F48, ZERO_I80F48 } from './fixednum';
import { Market, OpenOrders } from '@project-serum/serum';
import BN from 'bn.js';
import {
  AssetType,
  MangoAccountLayout,
  MangoCache,
  QUOTE_INDEX,
} from './layout';
import { MangoAccount, MangoGroup, PerpMarket, RootBank } from '.';

const interval = parseInt(process.env.INTERVAL || '3500');
const refreshAccountsInterval = parseInt(process.env.INTERVAL || '30000');
const config = new Config(configFile);

const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
const groupName = process.env.GROUP || 'devnet.0';
const groupIds = config.getGroup(cluster, groupName);
if (!groupIds) {
  throw new Error(`Group ${groupName} not found`);
}
const openOrdersAccountSpan = OpenOrders.getLayout(
  groupIds.serumProgramId,
).span;
const openOrdersAccountOwnerOffset = OpenOrders.getLayout(
  groupIds.serumProgramId,
).offsetOf('owner');
const mangoProgramId = groupIds.mangoProgramId;
const mangoGroupKey = groupIds.publicKey;
const payer = new Account(
  JSON.parse(
    process.env.KEYPAIR ||
      fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
  ),
);
console.log(`Payer: ${payer.publicKey.toBase58()}`);
const connection = new Connection(
  config.cluster_urls[cluster],
  'processed' as Commitment,
);
const client = new MangoClient(connection, mangoProgramId);

const liqorMangoAccountKey = new PublicKey(
  'Db6shuaGQC9rJjfK9wYRXVTAdSWCiDbEYDgyVidfWMqH',
);
const liqeeMangoAccountKey = new PublicKey(
  'CiLbJRhSj4cqYYwn3Sxs5PvYnshrowDR4XELBmAiWQPn',
);

async function main() {
  if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
  }

  const m = await Market.load(
    connection,
    new PublicKey('4DhsFeFJKHU53G2JkPeAx6tLPsStETDyhxbCdoWMM6FS'),
    undefined,
    groupIds.serumProgramId,
  );
  console.log(
    m['_decoded'].quoteLotSize.toString(),
    m['_decoded'].baseLotSize.toString(),
  );
  if (m) {
    return;
  }
  console.log(`Starting liquidator for ${groupName}...`);
  const liquidating = {};
  const mangoGroup = await client.getMangoGroup(mangoGroupKey);

  let mangoAccounts: MangoAccount[] = [];
  await refreshAccounts(mangoAccounts, mangoGroup);
  watchAccounts(mangoAccounts, mangoGroup);

  // eslint-disable-next-line
  while (true) {
    try {
      console.time('groupInfo');
      const mangoGroup = await client.getMangoGroup(mangoGroupKey);
      const cache = await mangoGroup.loadCache(connection);

      const liqorMangoAccount = await client.getMangoAccount(
        liqorMangoAccountKey,
        mangoGroup.dexProgramId,
      );

      await sleep(interval);
      const perpMarkets = await Promise.all(
        groupIds.perpMarkets.map((perpMarket, index) => {
          return mangoGroup.loadPerpMarket(
            connection,
            index,
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
      console.timeEnd('groupInfo');
      await sleep(interval);
      console.time('checkAccounts');
      for (let mangoAccount of mangoAccounts) {
        try {
          const health = mangoAccount.getHealth(mangoGroup, cache, 'Maint');
          if (health.lt(ZERO_I80F48)) {
            if (
              !liquidating[mangoAccount.publicKey.toBase58()] &&
              mangoAccount.publicKey.equals(liqeeMangoAccountKey)
            ) {
              console.log(
                `Sick account ${mangoAccount.publicKey.toBase58()} health: ${health.toString()}`,
              );
              liquidating[mangoAccount.publicKey.toBase58()] = true;
              // TODO: Check bankruptcy here
              console.log('forceCancelPerpOrders');
              // TODO: Only do this for markets with oos
              await Promise.all(
                perpMarkets.map((perpMarket) => {
                  return client.forceCancelPerpOrders(
                    mangoGroup,
                    mangoAccount,
                    perpMarket,
                    payer,
                    new BN(5),
                  );
                }),
              );
              await sleep(interval * 5);
              mangoAccount = await mangoAccount.reload(connection);
              await Promise.all([
                liquidateSpot(
                  mangoGroup,
                  cache,
                  spotMarkets,
                  rootBanks,
                  mangoAccount,
                  liqorMangoAccount,
                ),
                liquidatePerps(
                  mangoGroup,
                  cache,
                  perpMarkets,
                  rootBanks,
                  mangoAccount,
                  liqorMangoAccount,
                ),
              ])
                .then((values) => {
                  console.log(
                    'Liquidated account',
                    mangoAccount.publicKey.toBase58(),
                  );
                  console.log(values);
                })
                .catch((err) => {
                  console.log(
                    'Failed to liquidate account',
                    mangoAccount.publicKey.toBase58(),
                    err,
                  );
                })
                .finally(() => {
                  liquidating[mangoAccount.publicKey.toBase58()] = false;
                });
            }
          }
        } catch (err) {
          console.error(
            `Failed to process account ${mangoAccount.publicKey.toBase58()}`,
            err,
          );
        }
      }
      console.timeEnd('checkAccounts');
      await sleep(interval);
    } catch (err) {}
  }
}

function watchAccounts(mangoAccounts: MangoAccount[], mangoGroup: MangoGroup) {
  connection.onProgramAccountChange(
    mangoGroup.publicKey,
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
      }
    },
    'singleGossip',
    [{ dataSize: MangoAccountLayout.span }],
  );
  connection.onProgramAccountChange(
    mangoGroup.dexProgramId,
    ({ accountId, accountInfo }) => {
      if (accountInfo.data.length == openOrdersAccountSpan) {
        console.log('oos changed');
        console.log(accountId.toBase58());
        const ownerIndex = mangoAccounts.findIndex((account) =>
          account.spotOpenOrders.some((key) => key.equals(accountId)),
        );

        if (ownerIndex > -1) {
          console.log('found owner');
          mangoAccounts[ownerIndex].spotOpenOrdersAccounts.forEach((oo, i) => {
            if (oo && oo.address.equals(accountId)) {
              console.log('updated account at ' + i);
              mangoAccounts[ownerIndex].spotOpenOrdersAccounts[i] =
                OpenOrders.fromAccountInfo(
                  accountId,
                  accountInfo,
                  mangoGroup.dexProgramId,
                );
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

async function refreshAccounts(
  mangoAccounts: MangoAccount[],
  mangoGroup: MangoGroup,
) {
  try {
    console.log('Refreshing accounts...');
    console.time('getAllMangoAccounts');
    const accounts = await client.getAllMangoAccounts(
      mangoGroup,
      undefined,
      true,
    );
    mangoAccounts.splice(0, mangoAccounts.length, ...accounts);
    console.timeEnd('getAllMangoAccounts');
    console.log(`Fetched ${accounts.length} accounts`);
  } catch (err) {
    console.error('Error reloading accounts', err);
  } finally {
    setTimeout(
      refreshAccounts,
      refreshAccountsInterval,
      mangoAccounts,
      mangoGroup,
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
  for (let i = 0; i < mangoGroup.spotMarkets.length - 1; i++) {
    const spotMarket = spotMarkets[i];
    const spotMarketInfo = mangoGroup.spotMarkets[i];

    const baseRootBank = rootBanks[i];
    const quoteRootBank = rootBanks[rootBanks.length - 1];

    if (baseRootBank && quoteRootBank) {
      if (liqee.inMarginBasket[i]) {
        console.log('cancelling spot for market ', i);
        await client.forceCancelSpotOrders(
          mangoGroup,
          liqee,
          spotMarket,
          baseRootBank,
          quoteRootBank,
          payer,
          new BN(1),
        );
        await sleep(interval);
      }
    }
  }

  let minNet = ZERO_I80F48;
  let minNetIndex = -1;
  let maxNet = ZERO_I80F48;
  let maxNetIndex = QUOTE_INDEX;
  if (minNetIndex === -1) {
    // In this case, send a random token account that is not maxNetIndex
    minNetIndex = (maxNetIndex + 1) % mangoGroup.tokens.length;
  }
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
  console.log(minNetIndex);
  console.log(minNet.toString());
  console.log(maxNetIndex);
  console.log(maxNet.toString());
  console.log(
    liqee
      .getNativeBorrow(cache.rootBankCache[minNetIndex], minNetIndex)
      .toString(),
  );
  const liabRootBank = rootBanks[minNetIndex];
  const assetRootBank = rootBanks[maxNetIndex];

  if (assetRootBank && liabRootBank) {
    await client.liquidateTokenAndToken(
      mangoGroup,
      liqee,
      liqor,
      assetRootBank,
      liabRootBank,
      payer,
      new I80F48(uiToNative(1000, mangoGroup.tokens[minNetIndex].decimals)),
    );
    console.log(
      'liquidated max ' +
        uiToNative(1000, mangoGroup.tokens[minNetIndex].decimals).toString() +
        ' of liab',
    );
    liqee = await liqee.reload(connection);
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
          new I80F48(
            uiToNative(10000000, mangoGroup.tokens[minNetIndex].decimals),
          ),
        );
      }
    }
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
  const lowestHealthMarket = mangoGroup.perpMarkets
    .map((perpMarketInfo, marketIndex) => {
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

      return { perpHealth: perpHealth, marketIndex: marketIndex };
    })
    .sort((a, b) => {
      return a.perpHealth.sub(b.perpHealth).toNumber();
    })[0];

  const marketIndex = lowestHealthMarket.marketIndex;
  const perpAccount = liqee.perpAccounts[marketIndex];
  const perpMarket = perpMarkets[marketIndex];
  const baseRootBank = rootBanks[marketIndex];

  if (!baseRootBank) {
    throw new Error(`Base root bank not found for ${marketIndex}`);
  }

  if (lowestHealthMarket.perpHealth.lt(ZERO_I80F48)) {
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
          new I80F48(uiToNative(1000, mangoGroup.tokens[marketIndex].decimals)),
        );
      }
    } else {
      console.log('liquidatePerpMarket ' + marketIndex);
      await client.liquidatePerpMarket(
        mangoGroup,
        liqee,
        liqor,
        perpMarkets[marketIndex],
        payer,
        uiToNative(1000, mangoGroup.tokens[marketIndex].decimals),
      );
    }
    await sleep(interval);
    liqee = await liqee.reload(connection);
    if (liqee.isBankrupt) {
      console.log('Bankrupt account', liqee.publicKey.toBase58());
      await client.resolvePerpBankruptcy(
        mangoGroup,
        liqee,
        liqor,
        perpMarket,
        baseRootBank,
        payer,
        marketIndex,
        new I80F48(uiToNative(100, mangoGroup.tokens[marketIndex].decimals)),
      );
    }
  }
}

main();
