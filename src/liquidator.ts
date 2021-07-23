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
import { Market } from '@project-serum/serum';
import BN from 'bn.js';
import { AssetType, MangoCache, perpMarketInfoLayout } from './layout';
import { MangoAccount, MangoGroup, PerpMarket, RootBank } from '.';
import { QUOTE_INDEX } from './MangoGroup';

const interval = process.env.INTERVAL || 3500;
const config = new Config(configFile);

const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
const groupName = process.env.GROUP || 'mango_test_v3.nightly';
const groupIds = config.getGroup(cluster, groupName);
if (!groupIds) {
  throw new Error(`Group ${groupName} not found`);
}
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
  'Dgwt7kchNmM6jwVsDDU1yracgmJBoGE1Wr5X6pUokJGp',
);

async function main() {
  if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
  }
  console.log(`Starting liquidator for ${groupName}...`);
  const liquidating = {};

  // eslint-disable-next-line
  while (true) {
    console.time('groupInfo');
    const mangoGroup = await client.getMangoGroup(mangoGroupKey);
    const cache = await mangoGroup.loadCache(connection);

    console.log('calling get all mango accounts');
    const liqorMangoAccount = await client.getMangoAccount(
      liqorMangoAccountKey,
      mangoGroup.dexProgramId,
    );
    const mangoAccounts = await client.getAllMangoAccounts(
      mangoGroup,
      undefined,
      true,
    );
    console.log('got ' + mangoAccounts.length + ' accounts');
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
    console.time('checkAccounts');
    await sleep(interval);
    for (let mangoAccount of mangoAccounts) {
      try {
        const health = mangoAccount.getHealth(mangoGroup, cache, 'Maint');
        if (health.lt(ZERO_I80F48)) {
          if (
            !liquidating[mangoAccount.publicKey.toBase58()] &&
            mangoAccount.publicKey.toBase58() !=
              'GSrPgiqrFBGjai6Udw9qoU3poVKj5vJLxRfsoYyZbw4s'
          ) {
            console.log(
              `Sick account ${mangoAccount.publicKey.toBase58()} health: ${health.toString()}`,
            );
            liquidating[mangoAccount.publicKey.toBase58()] = true;
            // if (mangoAccount.isBankrupt) {
            //   let minNet = ZERO_I80F48;
            //   let minNetIndex = -1;

            //   for (let i = 0; i < mangoGroup.tokens.length; i++) {
            //     const price = cache.priceCache[i]
            //       ? cache.priceCache[i].price
            //       : ONE_I80F48;

            //     const netDeposit = mangoAccount
            //       .getNativeDeposit(cache.rootBankCache[i], i)
            //       .sub(mangoAccount.getNativeBorrow(cache.rootBankCache[i], i))
            //       .mul(price);

            //     if (netDeposit.lt(minNet)) {
            //       minNet = netDeposit;
            //       minNetIndex = i;
            //     }
            //   }
            //   const quoteRootBank = rootBanks[QUOTE_INDEX];
            //   const liabRootBank = rootBanks[minNetIndex];
            //   console.log('minnetindex', minNetIndex);
            //   console.log('quoteindex', QUOTE_INDEX);
            //   if (quoteRootBank && liabRootBank) {
            //     await client.resolveTokenBankruptcy(
            //       mangoGroup,
            //       mangoAccount,
            //       liqorMangoAccount,
            //       quoteRootBank,
            //       liabRootBank,
            //       payer,
            //       new I80F48(
            //         uiToNative(
            //           100000000,
            //           mangoGroup.tokens[minNetIndex].decimals,
            //         ),
            //       ),
            //     );
            //   }
            // }
            console.log('forceCancelPerpOrders');
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
            await sleep(interval);
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
          new BN(5),
        );
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
  console.log(minNetIndex);
  console.log(minNet.toString());
  console.log(maxNetIndex);
  console.log(maxNet.toString());
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
      minNet.mul(I80F48.fromNumber(-1)),
    );
    console.log(
      'liquidated max ' +
        uiToNative(100, mangoGroup.tokens[minNetIndex].decimals).toString() +
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
            uiToNative(100000000000, mangoGroup.tokens[minNetIndex].decimals),
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
          new I80F48(uiToNative(10, mangoGroup.tokens[marketIndex].decimals)),
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
        uiToNative(1, mangoGroup.tokens[marketIndex].decimals),
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
