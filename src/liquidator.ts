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
import { AssetType, MangoCache } from './layout';
import { MangoAccount, MangoGroup } from '.';

export class Liquidator {
  /**
   * Long running program that never exits except on keyboard interrupt
   */
  liquidating: any;
  constructor() {
    this.liquidating = {};
  }
  async run() {
    const interval = process.env.INTERVAL || 3500;
    const config = new Config(configFile);

    const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
    const groupName = process.env.GROUP || 'mango_test_v3.4';
    const groupIds = config.getGroup(cluster, groupName);

    if (!groupIds) {
      throw new Error(`Group ${groupName} not found`);
    }

    console.log(`Starting liquidator for ${groupName}...`);
    const mangoProgramId = groupIds.mangoProgramId;
    const mangoGroupKey = groupIds.publicKey;
    const payer = new Account(
      JSON.parse(
        process.env.KEYPAIR ||
          fs.readFileSync(
            os.homedir() + '/.config/solana/devnet.json',
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

    const liqorMangoAccountKey = new PublicKey(
      '6jHCjBA21Tecs1NHEkhqHvqsNoxM6e11vYHppvbpMvV8',
    );

    // eslint-disable-next-line
    while (true) {
      await sleep(interval);
      console.time('groupInfo');
      const mangoGroup = await client.getMangoGroup(mangoGroupKey);
      const cache = await mangoGroup.loadCache(connection);

      console.log('calling get all mango accounts');
      const liqorMangoAccount = await client.getMangoAccount(
        liqorMangoAccountKey,
        mangoGroup.dexProgramId,
      );
      const mangoAccounts = await client.getAllMangoAccounts(mangoGroup);
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
      for (let mangoAccount of mangoAccounts) {
        try {
          const health = mangoAccount.getHealth(mangoGroup, cache, 'Maint');
          if (health.lt(ZERO_I80F48)) {
            console.log(
              `Sick account ${mangoAccount.publicKey.toBase58()} health: ${health.toString()}`,
            );
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

            // Liquidate Spot

            // Liquidate Perps
            for (let i = 0; i < mangoGroup.perpMarkets.length - 1; i++) {
              const price = await mangoGroup.getPrice(i, cache);
              const perpAccount = mangoAccount.perpAccounts[i];
              const perpMarketInfo = mangoGroup.perpMarkets[i];
              const perpMarketCache = cache.perpMarketCache[i];
              const perpHealth = perpAccount.getHealth(
                perpMarketInfo,
                price,
                perpMarketInfo.maintAssetWeight,
                perpMarketInfo.maintLiabWeight,
                perpMarketCache.longFunding,
                perpMarketCache.shortFunding,
              );

              if (perpHealth.lt(ZERO_I80F48)) {
                if (perpAccount.basePosition.eq(new BN(0))) {
                  const rootBank = rootBanks[rootBanks.length - 1];
                  if (rootBank) {
                    console.log('liquidateTokenAndPerp ' + i);
                    await client.liquidateTokenAndPerp(
                      mangoGroup,
                      mangoAccount,
                      liqorMangoAccount,
                      rootBank,
                      payer,
                      AssetType.Token,
                      rootBanks.length - 1,
                      AssetType.Perp,
                      i,
                      new I80F48(uiToNative(10, mangoGroup.tokens[i].decimals)),
                    );
                  }
                } else {
                  console.log('liquidatePerpMarket ' + i);
                  //1.3226
                  await client.liquidatePerpMarket(
                    mangoGroup,
                    mangoAccount,
                    liqorMangoAccount,
                    perpMarkets[i],
                    payer,
                    uiToNative(1, mangoGroup.tokens[i].decimals),
                  );
                }
              }
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
    }
  }

  async liquidateSpot(
    mangoGroup: MangoGroup,
    cache: MangoCache,
    spotMarkets: [Market],
    liqee: MangoAccount,
  ) {
    for (let i = 0; i < mangoGroup.spotMarkets.length - 1; i++) {
      const spotMarket = spotMarkets[i];
      const spotMarketInfo = mangoGroup.spotMarkets[i];
      const spotHealth = mangoAccount.getSpotHealth(
        cache,
        i,
        spotMarketInfo.maintAssetWeight,
        spotMarketInfo.maintLiabWeight,
      );
      if (spotHealth.lt(ZERO_I80F48)) {
        const baseRootBank = rootBanks[i];
        const quoteRootBank = rootBanks[rootBanks.length - 1];

        if (!baseRootBank || !quoteRootBank) {
          throw new Error(
            `Error cancelling spot orders: RootBanks not found for market ${i}`,
          );
        }

        if (mangoAccount.inMarginBasket[i]) {
          await client.forceCancelSpotOrders(
            mangoGroup,
            mangoAccount,
            spotMarket,
            baseRootBank,
            quoteRootBank,
            payer,
            new BN(5),
          );
        }

        let minNet = ZERO_I80F48;
        let minNetIndex = -1;
        let maxNet = ZERO_I80F48;
        let maxNetIndex = mangoGroup.tokens.length - 1;
        const price = cache.priceCache[i]
          ? cache.priceCache[i].price
          : ONE_I80F48;

        const netDeposit = mangoAccount
          .getNativeDeposit(cache.rootBankCache[i], i)
          .sub(mangoAccount.getNativeBorrow(cache.rootBankCache[i], i))
          .mul(price);

        if (netDeposit.lt(minNet)) {
          minNet = netDeposit;
          minNetIndex = i;
        } else if (netDeposit.gt(maxNet)) {
          maxNet = netDeposit;
          maxNetIndex = i;
        }

        const assetRootBank = rootBanks[maxNetIndex];
        const liabRootBank = rootBanks[minNetIndex];

        if (assetRootBank && liabRootBank) {
          await client.liquidateTokenAndToken(
            mangoGroup,
            mangoAccount,
            liqorMangoAccount,
            assetRootBank,
            liabRootBank,
            payer,
            new I80F48(
              uiToNative(100, mangoGroup.tokens[maxNetIndex].decimals),
            ),
          );
        }
      }
    }
  }
}

new Liquidator().run();
