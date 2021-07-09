/**
This will probably move to its own repo at some point but easier to keep it here for now
 */
import * as os from 'os';
import * as fs from 'fs';
import { MangoClient } from './client';
import { Account, Commitment, Connection } from '@solana/web3.js';
import { sleep } from './utils';
import configFile from './ids.json';
import { Cluster, Config } from './config';
import { I80F48, ZERO_I80F48 } from './fixednum';
import { Market } from '@project-serum/serum';
import { RootBank } from '.';
import BN from 'bn.js';

export class Liquidator {
  /**
   * Long running program that never exits except on keyboard interrupt
   */
  async run() {
    const interval = process.env.INTERVAL || 3500;
    const config = new Config(configFile);

    const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
    const groupName = process.env.GROUP || 'mango_test_v3.3';
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

    // eslint-disable-next-line
    while (true) {
      await sleep(interval);
      console.time('groupInfo');
      const mangoGroup = await client.getMangoGroup(mangoGroupKey);
      const cache = await mangoGroup.loadCache(connection);

      console.log('calling get all mango accounts');

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

      const rootBanks = (await mangoGroup.loadRootBanks(connection)).filter(
        (rootBank) => {
          return rootBank != undefined;
        },
      ) as RootBank[];
      console.timeEnd('groupInfo');
      console.time('checkAccounts');
      for (let ma of mangoAccounts) {
        try {
          const health = ma.getHealth(mangoGroup, cache, 'Maint');
          if (health.lt(ZERO_I80F48)) {
            console.log(
              `Sick account ${ma.publicKey.toBase58()} health: ${health.toString()}`,
            );
            await Promise.all(
              perpMarkets.map((perpMarket) => {
                return client.forceCancelPerpOrders(
                  mangoGroup,
                  ma,
                  perpMarket,
                  payer,
                  new BN(5),
                );
              }),
            );

            // await Promise.all(
            //   spotMarkets.map((spotMarket) => {
            //     const baseRootBankKey = groupIds.tokens.find((tokenInfo) => {
            //       return (
            //         tokenInfo.mintKey.toString() ==
            //         spotMarket.baseMintAddress.toString()
            //       );
            //     })?.rootKey;
            //     const quoteRootBankKey = groupIds.tokens.find((tokenInfo) => {
            //       return (
            //         tokenInfo.mintKey.toString() ==
            //         spotMarket.quoteMintAddress.toString()
            //       );
            //     })?.rootKey;
            //     const baseRootBank = rootBanks.find((rootBank) => {
            //       return (
            //         rootBank.publicKey.toString() == baseRootBankKey?.toString()
            //       );
            //     });
            //     const quoteRootBank = rootBanks.find((rootBank) => {
            //       return (
            //         rootBank.publicKey.toString() ==
            //         quoteRootBankKey?.toString()
            //       );
            //     });
            //
            //     if (!baseRootBank || !quoteRootBank) {
            //       throw new Error(
            //         `Error cancelling spot orders: RootBanks not found for market ${spotMarket.publicKey.toBase58()}`,
            //       );
            //     }
            //
            //     return client.forceCancelSpotOrders(
            //       mangoGroup,
            //       ma,
            //       spotMarket,
            //       baseRootBank,
            //       quoteRootBank,
            //       payer,
            //       new BN(5),
            //     );
            //   }),
            // );
          }
        } catch (err) {
          console.error(
            `Failed to process account ${ma.publicKey.toBase58()}`,
            err,
          );
        }
      }
      console.timeEnd('checkAccounts');
    }
  }
}

new Liquidator().run();
