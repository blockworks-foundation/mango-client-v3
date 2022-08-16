import {
  Account,
  Commitment,
  Connection,
  Keypair,
  PublicKey,
} from '@solana/web3.js';
import { MangoClient } from '../client';
import { Cluster, Config } from '../config';
import * as fs from 'fs';
import * as os from 'os';
import { nativeToUi } from '../utils/utils';

const config = Config.ids();
const cluster = (process.env.CLUSTER || 'mainnet') as Cluster;
const connection = new Connection(
  config.cluster_urls[cluster],
  'confirmed' as Commitment,
);

const groupName = process.env.GROUP || 'mainnet.1';
const groupIds = config.getGroup(cluster, groupName)!;

const mangoProgramId = groupIds.mangoProgramId;
const mangoGroupKey = groupIds.publicKey;
const client = new MangoClient(connection, mangoProgramId);

const payer = Keypair.fromSecretKey(
  Uint8Array.from(
  JSON.parse(
    process.env.KEYPAIR ||
      fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
  )),
);

const makerPk = new PublicKey('6rnq9ajZpJCkDe3xP7WAs9KFgLAhQWA2gyz1zVv2cnTn');
const takerPk = new PublicKey('HGaFMw6fJmTzL3wq2H9tXXj2sx3BMg7kYtJmgedvKrJy');
const referrerPk = new PublicKey('DxUrnFn3GF9cK3YTv33oA4VVDP2yRa5BtS6MrHY5yFKY');

async function check() {
  const group = await client.getMangoGroup(mangoGroupKey);
  await group.loadRootBanks(connection);
  const perpMarketConfig = groupIds.perpMarkets.find(
    (p) => p.baseSymbol == 'AVAX',
  )!;
  const perpMarketInfo = group.perpMarkets[perpMarketConfig.marketIndex];
  const perpMarket = await group.loadPerpMarket(
    connection,
    perpMarketConfig.marketIndex,
    perpMarketConfig.baseDecimals,
    perpMarketConfig.quoteDecimals,
  );


  console.log('referrer mngo required', nativeToUi(group.refMngoRequired.toNumber(), 6), 'ref share', group.refShareCentibps, 'ref surcharge', group.refSurchargeCentibps)
  console.log(
    'maker fee',
    perpMarketInfo.makerFee.toNumber(),
    'taker fee',
    perpMarketInfo.takerFee.toNumber(),
  );
  if (cluster != 'mainnet') {
    const makerAccount = await client.getMangoAccount(
      makerPk,
      group.dexProgramId,
    );
    const takerAccount = await client.getMangoAccount(
      takerPk,
      group.dexProgramId,
    );
  // No referrer
  // Place maker order
  console.log(
    'maker order',
    await client.placePerpOrder2(
      group,
      makerAccount,
      perpMarket,
      payer,
      'sell',
      15.5,
      1,
    ),
  );
  // Place taker order that will match
  console.log(
    'taker order',
    await client.placePerpOrder2(
      group,
      takerAccount,
      perpMarket,
      payer,
      'buy',
      16,
      1,
    ),
  );

  // Load fills
  const fills = await perpMarket.loadFills(connection);
  const makerFills = fills.filter((f) => f.maker.equals(makerPk) && new Date(f.timestamp.toNumber() * 1000).getTime() > (new Date().getTime() - 30 * 1000));
  const takerFills = fills.filter((f) => f.taker.equals(takerPk) && new Date(f.timestamp.toNumber() * 1000).getTime() > (new Date().getTime() - 30 * 1000));

  makerFills.forEach((f) => {
    console.log(
      'maker fill',
      'price',
      f.price,
      'quantity',
      f.quantity,
      'maker fee',
      f.makerFee.toNumber(),
      'taker fee',
      f.takerFee.toNumber(),
      
    );
  });

  takerFills.forEach((f) => {
    console.log(
      'taker fill',
      'price',
      f.price,
      'quantity',
      f.quantity,
      'maker fee',
      f.makerFee.toNumber(),
      'taker fee',
      f.takerFee.toNumber(),
    );
  });

  // With referrer
  // Place maker order
  console.log(
    'maker order',
    await client.placePerpOrder2(
      group,
      makerAccount,
      perpMarket,
      payer,
      'sell',
      15.5,
      1,
      { referrerMangoAccountPk: referrerPk },
    ),
  );
  // Place taker order that will match
  console.log(
    'taker order',
    await client.placePerpOrder2(
      group,
      takerAccount,
      perpMarket,
      payer,
      'buy',
      16,
      1,
      { referrerMangoAccountPk: referrerPk },
    ),
  );

  // Load fills
  const referrerFills = await perpMarket.loadFills(connection);
  const referrerMakerFills = referrerFills.filter((f) =>
    f.maker.equals(makerPk) && new Date(f.timestamp.toNumber() * 1000).getTime() > (new Date().getTime() - 30 * 1000),
  );
  const referrerTakerFills = referrerFills.filter((f) =>
    f.taker.equals(takerPk) && new Date(f.timestamp.toNumber() * 1000).getTime() > (new Date().getTime() - 30 * 1000),
  );

  referrerMakerFills.forEach((f) => {
    console.log(
      'maker fill',
      'price',
      f.price,
      'quantity',
      f.quantity,
      'maker fee',
      f.makerFee.toNumber(),
      'taker fee',
      f.takerFee.toNumber(),
    );
  });

  referrerTakerFills.forEach((f) => {
    console.log(
      'taker fill',
      'price',
      f.price,
      'quantity',
      f.quantity,
      'maker fee',
      f.makerFee.toNumber(),
      'taker fee',
      f.takerFee.toNumber(),
    );
  });
  }
}

check();
