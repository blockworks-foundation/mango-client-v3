import {
  Config,
  getMarketByBaseSymbolAndKind,
  GroupConfig,
  MangoClient,
  PerpEventQueue,
  PerpEventQueueLayout,
  ZERO_BN,
} from '../src';
import { Commitment, Connection } from '@solana/web3.js';
import configFile from '../src/ids.json';
import { ParsedFillEvent } from '../src/PerpMarket';

async function subscribeToOrderbook() {
  // setup client
  const config = new Config(configFile);
  const groupConfig = config.getGroupWithName('mainnet.1') as GroupConfig;
  const connection = new Connection(
    config.cluster_urls[groupConfig.cluster],
    'processed' as Commitment,
  );
  const client = new MangoClient(connection, groupConfig.mangoProgramId);

  // load group & market
  const perpMarketConfig = getMarketByBaseSymbolAndKind(
    groupConfig,
    'BTC',
    'perp',
  );
  const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);
  const perpMarket = await mangoGroup.loadPerpMarket(
    connection,
    perpMarketConfig.marketIndex,
    perpMarketConfig.baseDecimals,
    perpMarketConfig.quoteDecimals,
  );

  // subscribe to event queue
  const lastSeenSeqNum = ZERO_BN;
  connection.onAccountChange(perpMarketConfig.eventsKey, (accountInfo) => {
    const queue = new PerpEventQueue(
      PerpEventQueueLayout.decode(accountInfo.data),
    );
    const fills = queue
      .eventsSince(lastSeenSeqNum)
      .map((e) => e.fill)
      .filter((e) => !!e)
      .map((e) => perpMarket.parseFillEvent(e) as ParsedFillEvent);

    for (const fill of fills) {
      console.log(`New fill for ${fill.quantity} at ${fill.price}`);
    }
  });
}

subscribeToOrderbook();
