import { Commitment, Connection } from '@solana/web3.js';
import { getTokenBySymbol, PerpMarketConfig, SpotMarketConfig } from '..';
import { MangoClient } from '../client';
import { Cluster, Config } from '../config';
import RootBank from '../RootBank';

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
      `- maintAssetWeight: ${spotMarketInfo.maintAssetWeight
        .toNumber()
        .toFixed(2)}`,
    );
    console.log(
      `- initAssetWeight: ${spotMarketInfo.initAssetWeight
        .toNumber()
        .toFixed(2)}`,
    );
    console.log(
      `- maintLiabWeight: ${spotMarketInfo.maintLiabWeight
        .toNumber()
        .toFixed(2)}`,
    );
    console.log(
      `- initLiabWeight: ${spotMarketInfo.initLiabWeight
        .toNumber()
        .toFixed(2)}`,
    );
    console.log(
      `- liquidationFee: ${spotMarketInfo.liquidationFee
        .toNumber()
        .toFixed(2)}`,
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
    console.log(
      `- optimalUtil - ${rootBank.optimalUtil.toNumber().toFixed(2)}`,
    );
    console.log(
      `- optimalRate - ${rootBank.optimalRate.toNumber().toFixed(2)}`,
    );
    console.log(`- maxRate - ${rootBank.maxRate.toNumber().toFixed(2)}`);
    console.log(`- depositIndex - ${rootBank.depositIndex.toNumber()}`);
    console.log(`- borrowIndex - ${rootBank.borrowIndex.toNumber()}`);
    const date = new Date(0);
    date.setUTCSeconds(rootBank.lastUpdated.toNumber());
    console.log(`- lastUpdated - ${date.toUTCString()}`);
    console.log(``);
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

  // usdc
  const tokenBySymbol = getTokenBySymbol(groupIds, 'USDC');
  const tokenIndex = group.getTokenIndex(tokenBySymbol.mintKey);
  const rootBank = rootBanks[tokenIndex];
  await dumpRootBank('USDC', rootBank!);

  process.exit();
}

main();
