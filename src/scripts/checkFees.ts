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
import { sleep } from '@blockworks-foundation/mango-client';

const groupName = process.env.GROUP || 'devnet.2';
const cluster = (process.env.CLUSTER || groupName.split('.')[0]) as Cluster;

const config = Config.ids();
const connection = new Connection(
  config.cluster_urls[cluster],
  'confirmed' as Commitment,
);
const groupIds = config.getGroup(cluster, groupName)!;

const mangoProgramId = groupIds.mangoProgramId;
const mangoGroupKey = groupIds.publicKey;
const client = new MangoClient(connection, mangoProgramId);

const payer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      process.env.KEYPAIR ||
        fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
    ),
  ),
);

const makerPk = new PublicKey('6rnq9ajZpJCkDe3xP7WAs9KFgLAhQWA2gyz1zVv2cnTn');
const takerPk = new PublicKey('HGaFMw6fJmTzL3wq2H9tXXj2sx3BMg7kYtJmgedvKrJy');
const referrerPk = new PublicKey(
  'DxUrnFn3GF9cK3YTv33oA4VVDP2yRa5BtS6MrHY5yFKY',
);

async function check() {
  const group = await client.getMangoGroup(mangoGroupKey);
  console.log(
    'referrer mngo required',
    nativeToUi(group.refMngoRequired.toNumber(), 6),
    'ref share tier 1',
    group.refShareCentibpsTier1,
    'ref surcharge tier 1',
    group.refSurchargeCentibpsTier1,
    'ref share tier 2',
    group.refShareCentibpsTier2,
    'ref surcharge tier 2',
    group.refSurchargeCentibpsTier2,
  );

  if (groupName == 'devnet.2') {
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
    console.log(
      'maker fee',
      perpMarketInfo.makerFee.toNumber(),
      'taker fee',
      perpMarketInfo.takerFee.toNumber(),
    );
    const makerAccount = await client.getMangoAccount(
      makerPk,
      group.dexProgramId,
    );
    const takerAccount = await client.getMangoAccount(
      takerPk,
      group.dexProgramId,
    );
    const referrerAccount = await client.getMangoAccount(
      referrerPk,
      group.dexProgramId,
    );
    const cache = await group.loadCache(connection);
    const mngoIndex = group.getRootBankIndex(
      groupIds.tokens.find((t) => t.symbol == 'MNGO')!.rootKey,
    );
    console.log(
      'referrer mngo',
      referrerAccount
        .getUiDeposit(cache.rootBankCache[mngoIndex], group, mngoIndex)
        .toNumber(),
      'referrer avax quote',
      referrerAccount.perpAccounts[
        perpMarketConfig.marketIndex
      ].quotePosition.toNumber(),
    );
    // No referrer
    // Place maker order
    let ts = Date.now();
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
        { clientOrderId: ts },
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
    await sleep(5000);
    // Load fills
    const fills = (await perpMarket.loadFills(connection)).filter(
      (f) => f.maker.equals(makerPk) && f.makerClientOrderId.toNumber() == ts,
    );

    fills.forEach((f) => {
      console.log(
        'fill',
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
    ts = Date.now();
    console.log(
      'maker order (ref)',
      await client.placePerpOrder2(
        group,
        makerAccount,
        perpMarket,
        payer,
        'sell',
        15.5,
        1,
        { referrerMangoAccountPk: referrerPk, clientOrderId: ts },
      ),
    );
    // Place taker order that will match
    console.log(
      'taker order (ref)',
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
    await sleep(5000);
    // Load fills
    const referrerFills = (await perpMarket.loadFills(connection)).filter(
      (f) => f.maker.equals(makerPk) && f.makerClientOrderId.toNumber() == ts,
    );

    referrerFills.forEach((f) => {
      console.log(
        'fill (ref)',
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
