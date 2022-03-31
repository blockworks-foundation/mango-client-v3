import {
  Config,
  getMarketByBaseSymbolAndKind,
  GroupConfig,
  MangoClient,
} from '../src';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import configFile from '../src/ids.json';
import * as os from 'os';
import * as fs from 'fs';
import { BN } from 'bn.js';

async function cancelOrder() {
  // setup client
  const config = new Config(configFile);
  const groupConfig = config.getGroupWithName('mainnet.1') as GroupConfig;
  const connection = new Connection(
    config.cluster_urls[groupConfig.cluster],
    'processed' as Commitment,
  );
  const client = new MangoClient(connection, groupConfig.mangoProgramId);

  const payer = new Account(
    JSON.parse(
      fs.readFileSync(
        os.homedir() + '/.config/solana/my-mainnet.json',
        'utf-8',
      ),
    ),
  );

  // load group, account, market
  const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);
  await client.createMangoAccount(mangoGroup, payer, 23);
}

cancelOrder();
