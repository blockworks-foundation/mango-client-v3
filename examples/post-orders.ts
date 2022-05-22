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

async function postOrders() {
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

  // load group, cache, account, market
  const mangoAccountPk = new PublicKey('YOUR_MANGOACCOUNT_KEY');
  const mangoGroup = await client.getMangoGroup(groupConfig.publicKey);
  const mangoAccount = await client.getMangoAccount(
    mangoAccountPk,
    mangoGroup.dexProgramId,
  );

  const perpMarketConfig = getMarketByBaseSymbolAndKind(
    groupConfig,
    'BTC',
    'perp',
  );
  const perpMarket = await mangoGroup.loadPerpMarket(
    connection,
    perpMarketConfig.marketIndex,
    perpMarketConfig.baseDecimals,
    perpMarketConfig.quoteDecimals,
  );

  // post an ask for 1btc at 50000
  await client.placePerpOrder2(
    mangoGroup,
    mangoAccount,
    perpMarket,
    payer,
    'sell',
    50000,
    1,
    {
      orderType: 'postOnly',
    },
  );
}

postOrders();
