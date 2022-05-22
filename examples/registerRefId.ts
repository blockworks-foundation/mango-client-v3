import fs from 'fs';
import os from 'os';
import { Cluster, Config, GroupConfig, IDS, MangoClient } from '../src';
import { Keypair, Commitment, Connection, PublicKey } from '@solana/web3.js';

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

  const groupIds = config.getGroupWithName('devnet.2') as GroupConfig;
  if (!groupIds) {
    throw new Error(`Group ${'devnet.2'} not found`);
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
    new PublicKey('FG99s25HS1UKcP1jMx72Gezg6KZCC7DuKXhNW51XC1qi'),
    mangoGroup.dexProgramId,
  );
  const t0 = await client.setReferrerMemory(
    mangoGroup,
    mangoAccount,
    payer,
    mangoAccount.publicKey,
  );
  console.log(t0.toString());
  const txid = await client.registerReferrerId(
    mangoGroup,
    mangoAccount,
    payer,
    'daffy',
  );
  console.log(txid.toString());
}

main();
