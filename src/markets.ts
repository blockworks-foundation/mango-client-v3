import { Commitment, Connection, PublicKey } from '@solana/web3.js';
import { group } from 'console';
import {
  getTokenBySymbol,
  I80F48,
  PerpMarket,
  PerpMarketConfig,
  SpotMarketConfig,
} from '.';
import { MangoClient } from './client';
import { Cluster, Config } from './config';
import { Market } from '@project-serum/serum';
import * as Process from 'process';
import RootBank from './RootBank';
import BN from 'bn.js';

// e.g. CLUSTER=devnet GROUP=devnet.2 yarn ts-node src/markets.ts
// e.g. SYMBOL=MNGO CLUSTER=devnet GROUP=devnet.3 yarn ts-node src/markets.ts
async function main() {
  const config = Config.ids();
  const cluster = (process.env.CLUSTER || 'mainnet') as Cluster;
  const connection = new Connection(
    config.cluster_urls[cluster],
    'processed' as Commitment,
  );

  const groupName = process.env.GROUP || 'mainnet.1';
  const groupIds = config.getGroup(cluster, groupName);
  if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
  }

  const mangoProgramId = groupIds.mangoProgramId;
  const mangoGroupKey = groupIds.publicKey;
  const client = new MangoClient(connection, mangoProgramId);

  const group = await client.getMangoGroup(mangoGroupKey);
  const rootBanks = await group.loadRootBanks(connection);

  async function dumpPerpMarket(config: PerpMarketConfig) {
    const market = await client.getPerpMarket(
      config.publicKey,
      config.baseDecimals,
      config.quoteDecimals,
    );

    console.log(market.toPrettyString(group, config), '\n');
  }

  async function dumpSpotMarket(spotMarketConfig: SpotMarketConfig) {
    const spotMarketInfo =
      group.spotMarkets[group.getSpotMarketIndex(spotMarketConfig.publicKey)];
    console.log(`----- ${spotMarketConfig.name} SpotMarketInfo -----`);
    console.log(
      `- maintAssetWeight: ${spotMarketInfo.maintAssetWeight.toNumber()}`,
    );
    console.log(
      `- initAssetWeight: ${spotMarketInfo.initAssetWeight.toNumber()}`,
    );
    console.log(
      `- maintLiabWeight: ${spotMarketInfo.maintLiabWeight.toNumber()}`,
    );
    console.log(
      `- initLiabWeight: ${spotMarketInfo.initLiabWeight.toNumber()}`,
    );
    console.log(
      `- liquidationFee: ${spotMarketInfo.liquidationFee.toNumber()}`,
    );
    console.log(``);
  }

  for (const m of groupIds.perpMarkets.filter((config) =>
    process.env.SYMBOL ? config.baseSymbol === process.env.SYMBOL : true,
  )) {
    await dumpPerpMarket(m);
  }

  async function dumpRootBank(name: string, rootBank: RootBank) {
    console.log(`----- ${name} RootBank -----`);
    console.log(`- optimalUtil - ${rootBank.optimalUtil.toNumber()}`);
    console.log(`- optimalRate - ${rootBank.optimalRate.toNumber()}`);
    console.log(`- maxRate - ${rootBank.maxRate.toNumber()}`);
    console.log(`- depositIndex - ${rootBank.depositIndex.toNumber()}`);
    console.log(`- borrowIndex - ${rootBank.borrowIndex.toNumber()}`);
    const date = new Date(0);
    date.setUTCSeconds(rootBank.lastUpdated.toNumber());
    console.log(`- lastUpdated - ${date.toUTCString()}`);
  }

  for (const m of groupIds.spotMarkets.filter((config) =>
    process.env.SYMBOL ? config.baseSymbol === process.env.SYMBOL : true,
  )) {
    await dumpSpotMarket(m);
    const tokenBySymbol = getTokenBySymbol(groupIds, m.baseSymbol);
    const tokenIndex = group.getTokenIndex(tokenBySymbol.mintKey);
    const rootBank = rootBanks[tokenIndex];
    await dumpRootBank(m.baseSymbol, rootBank!);
  }

  process.exit();
}

main();
