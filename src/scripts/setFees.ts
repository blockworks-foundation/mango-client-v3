import {
  Account,
  Commitment,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { MangoClient } from '../client';
import { Cluster, Config } from '../config';
import * as fs from 'fs';
import * as os from 'os';
import { nativeToUi, uiToNative } from '../utils/utils';
import { sleep } from '@blockworks-foundation/mango-client';
import { makeChangeReferralFeeParams2Instruction } from '../instruction';
import { BN } from 'bn.js';

const groupName = process.env.GROUP || 'devnet.3';
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
  let group = await client.getMangoGroup(mangoGroupKey);

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

  const ix = makeChangeReferralFeeParams2Instruction(
    groupIds.mangoProgramId,
    mangoGroupKey,
    payer.publicKey,
    new BN(90),
    new BN(85),
    new BN(100),
    new BN(90),
    uiToNative(10000, 6),
    new BN(10),
  );
  const tx = new Transaction().add(ix);
  await client.sendTransaction(tx, payer, []);
  await sleep(5000);
  group = await client.getMangoGroup(mangoGroupKey);

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
}

check();
