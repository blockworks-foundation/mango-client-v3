import { Market } from '@project-serum/serum';
import { Commitment, Connection, PublicKey } from '@solana/web3.js';
import { MangoClient } from '../client';
import { Cluster, Config } from '../config';

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

  for (let pk of [
    '9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT',
    '77quYg4MGneUdjgXCunt9GgM1usmrxKY31twEy3WHwcS',
    '6oGsL2puUgySccKzn9XA9afqF217LfxP5ocq4B3LWsjy',
    '8Gmi2HhZmwQPVdCwzS7CM66MGstMXPcTVHA7jF19cLZz',
    '2xiv8A5xrJ7RnGdxXB42uFEkYHJjszEhaJyKKt4WaLep',
    '3d4rzwpy9iGdCZvgxcu7B1YocYffVLsQXPXkBZKt2zLc',
    '65HCcVzCVLDLEUHVfQrvE5TmHAUKgnCnbii9dojxE7wV',
  ]) {
    let mkt = await Market.load(
      connection,
      new PublicKey(pk),
      undefined,
      groupIds.serumProgramId,
    );

    console.log('pk:', pk);
    const {
      eventQueue,
      requestQueue,
      bids,
      asks,
      quoteDustThreshold,
      feeRateBps,
      baseLotSize,
      quoteLotSize,
    } = mkt['_decoded'];

    console.log('minOrderSize', mkt.minOrderSize);
    console.log('tickSize', mkt.tickSize);

    console.log('baseToken', mkt.baseMintAddress.toString());
    console.log('baseLotSize', baseLotSize.toNumber());
    console.log('quoteLotSize', quoteLotSize.toNumber());
    console.log('feeRateBps', feeRateBps.toNumber());
    console.log('quoteDustThreshold', quoteDustThreshold.toNumber());

    const [eq, rq, bs, as] = await Promise.all([
      connection.getAccountInfo(eventQueue),
      connection.getAccountInfo(requestQueue),
      connection.getAccountInfo(bids),
      connection.getAccountInfo(asks),
    ]);

    console.log('eventQueueSize', eq?.data.byteLength);
    console.log('requestQueueSize', rq?.data.byteLength);
    console.log('bidsSize', bs?.data.byteLength);
    console.log('asksSize', as?.data.byteLength);

    console.log(
      'sol',
      (eq!.lamports + bs!.lamports + as!.lamports) / 1_000_000_000,
    );

    console.log('------------------------');
    // console.log(mkt['_decoded']);
  }
}

main();
