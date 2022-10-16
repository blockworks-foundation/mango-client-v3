import {
  BookSide,
  BookSideLayout,
  Config,
  getMarketByBaseSymbolAndKind,
  GroupConfig,
  MangoClient,
} from '../src';
import { Commitment, Connection } from '@solana/web3.js';
import configFile from '../src/ids.json';
import BN from "bn.js";

async function subscribeToOrderbook() {
  // setup client
  const config = new Config(configFile);
  const groupConfig = config.getGroupWithName('devnet.2') as GroupConfig;
  const connection = new Connection(
    config.cluster_urls[groupConfig.cluster],
    'processed' as Commitment,
  );
  const client = new MangoClient(connection, groupConfig.mangoProgramId);

  // load group & market
  const perpMarketConfig = getMarketByBaseSymbolAndKind(
    groupConfig,
    'SOL',
    'perp',
  );
  const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);
  const perpMarket = await mangoGroup.loadPerpMarket(
    connection,
    perpMarketConfig.marketIndex,
    perpMarketConfig.baseDecimals,
    perpMarketConfig.quoteDecimals,
  );

  // subscribe to bids
  connection.onAccountChange(perpMarketConfig.bidsKey, (accountInfo) => {
    const bids = new BookSide(
      perpMarketConfig.bidsKey,
      perpMarket,
      BookSideLayout.decode(accountInfo.data),
    );

    const [_, nativeQuantity] = perpMarket.uiToNativePriceQuantity(0, 25000)

    console.log(nativeQuantity.toString())

    console.log(bids.getImpactPriceUi(nativeQuantity))

  });
}

subscribeToOrderbook();
