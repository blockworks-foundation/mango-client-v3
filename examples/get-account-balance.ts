import { Config, GroupConfig, MangoClient } from '../src';
import { Commitment, Connection, PublicKey } from '@solana/web3.js';
import configFile from '../src/ids.json';

async function getAccountBalance() {
  // setup client
  const config = new Config(configFile);
  const groupConfig = config.getGroupWithName('mainnet.1') as GroupConfig;
  const connection = new Connection(
    config.cluster_urls[groupConfig.cluster],
    'processed' as Commitment,
  );
  const client = new MangoClient(connection, groupConfig.mangoProgramId);

  // load group, cache, account
  const mangoAccountPk = new PublicKey('YOUR_MANGOACCOUNT_KEY');
  const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);
  const cache = await mangoGroup.loadCache(connection);
  const mangoAccount = await client.getMangoAccount(
    mangoAccountPk,
    mangoGroup.dexProgramId,
  );

  // print account balances
  console.log(mangoAccount.toPrettyString(groupConfig, mangoGroup, cache));
}

getAccountBalance();
