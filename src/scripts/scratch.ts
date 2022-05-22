import { Cluster, Config, GroupConfig } from '../config';
import { Keypair, Commitment, Connection, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import os from 'os';
import { IDS, MangoClient, QUOTE_INDEX, RootBank } from '../index';

async function main() {
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        process.env.KEYPAIR ||
          fs.readFileSync(
            os.homedir() + '/.config/solana/devnet.json',
            'utf-8',
          ),
      ),
    ),
  );

  const config = new Config(IDS);

  const groupIds = config.getGroupWithName('mainnet.1') as GroupConfig;
  if (!groupIds) {
    throw new Error(`Group ${'mainnet.1'} not found`);
  }
  const cluster = groupIds.cluster as Cluster;
  const mangoProgramId = groupIds.mangoProgramId;
  const mangoGroupKey = groupIds.publicKey;
  const connection = new Connection(
    process.env.ENDPOINT_URL || config.cluster_urls[cluster],
    'processed' as Commitment,
  );
  const client = new MangoClient(connection, mangoProgramId);
  const mangoGroup = await client.getMangoGroup(mangoGroupKey);

  const mangoAccount = await client.getMangoAccount(
    new PublicKey(''),
    mangoGroup.dexProgramId,
  );
  const rootBanks = await mangoGroup.loadRootBanks(connection);
  const quoteRootBank = rootBanks[QUOTE_INDEX] as RootBank;
  const mangoCache = await mangoGroup.loadCache(connection);
  const perpMarkets = await Promise.all(
    groupIds.perpMarkets.map((pmc) =>
      client.getPerpMarket(pmc.publicKey, pmc.baseDecimals, pmc.quoteDecimals),
    ),
  );

  const x = mangoAccount.calcTotalPerpPosUnsettledPnl(mangoGroup, mangoCache);
  console.log(x.toNumber() / Math.pow(10, 6));
  const txids = await client.settlePosPnl(
    mangoGroup,
    mangoCache,
    mangoAccount,
    perpMarkets,
    quoteRootBank,
    payer,
  );
  console.log(txids);
}

main();
