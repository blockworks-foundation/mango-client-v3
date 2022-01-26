import { Commitment, Connection, PublicKey } from '@solana/web3.js';
import { group } from 'console';
import { I80F48, PerpMarket, PerpMarketConfig, SpotMarketConfig } from '.';
import { MangoClient } from './client';
import { Cluster, Config } from './config';
import { Market } from '@project-serum/serum';

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

  async function dumpPerpMarket(config: PerpMarketConfig) {
    const group = await client.getMangoGroup(mangoGroupKey);
    const market = await client.getPerpMarket(
      config.publicKey,
      config.baseDecimals,
      config.quoteDecimals,
    );

    console.log(market.toPrettyString(group, config), '\n');
  }

  async function dumpSpotMarket(spotMarketConfig: SpotMarketConfig) {
    const group = await client.getMangoGroup(mangoGroupKey);
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

  for (const m of groupIds.perpMarkets) {
    await dumpPerpMarket(m);
  }
  for (const m of groupIds.spotMarkets) {
    await dumpSpotMarket(m);
  }
  process.exit(0);
}

main();
