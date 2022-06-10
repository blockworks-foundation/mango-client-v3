import { Config, GroupConfig, MangoClient } from '../src';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import configFile from '../src/ids.json';
import * as os from 'os';
import * as fs from 'fs';

async function cancelOrders() {
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
  const mangoAccountPk = new PublicKey('YOUR_MANGOACCOUNT_KEY');
  const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);
  const mangoAccount = await client.getMangoAccount(
    mangoAccountPk,
    mangoGroup.dexProgramId,
  );

  const perpMarkets = await Promise.all(
    groupConfig.perpMarkets.map((perpMarket) => {
      return mangoGroup.loadPerpMarket(
        connection,
        perpMarket.marketIndex,
        perpMarket.baseDecimals,
        perpMarket.quoteDecimals,
      );
    }),
  );

  // cancel all perp orders on all markets
  await client.cancelAllPerpOrders(
    mangoGroup,
    perpMarkets,
    mangoAccount,
    payer,
  );
}

cancelOrders();
