import { Connection, PublicKey } from '@solana/web3.js';
import {
  IDS,
  MangoClient,
  MarketMode,
  ONE_I80F48,
  TokenAccount,
  TokenAccountLayout,
  ZERO_BN,
  ZERO_I80F48,
} from '../..';
import { Cluster, Config } from '../../config';

const config = new Config(IDS);

const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
const groupName = process.env.GROUP || 'devnet.3';
const marketIndex = 1;
const groupIds = config.getGroup(cluster, groupName)!;

async function checkSpotMarket() {
  const connection = new Connection(config.cluster_urls[cluster]);
  const client = new MangoClient(connection, groupIds.mangoProgramId);
  const mangoGroup = await client.getMangoGroup(groupIds.publicKey);

  const rootBank = (await mangoGroup.loadRootBanks(connection))[marketIndex]!;
  const nodeBanks = await rootBank.loadNodeBanks(connection);
  const vaults = await Promise.all(
    nodeBanks.map((n) => {
      return connection.getAccountInfo(n.vault).then((ai) => {
        return new TokenAccount(n.vault, TokenAccountLayout.decode(ai!.data));
      });
    }),
  );
  const accounts = await client.getAllMangoAccounts(
    mangoGroup,
    undefined,
    true,
  );
  let hasOpenOrdersAccounts = false;
  const vaultBalance = vaults.reduce((sum, v) => sum + v.amount, 0);

  for (const account of accounts) {
    if (!account.spotOpenOrders[marketIndex].equals(PublicKey.default)) {
      hasOpenOrdersAccounts = true;
      console.log('Account', account.publicKey.toBase58(), 'has open orders account', account.spotOpenOrders[marketIndex].toBase58());
    }
  }

  const [dustAccountPk] = await PublicKey.findProgramAddress(
    [mangoGroup.publicKey.toBytes(), Buffer.from('DustAccount', 'utf-8')],
    groupIds.mangoProgramId,
  );

  const dustAccount = await client.getMangoAccount(dustAccountPk, mangoGroup.dexProgramId);

  const nonDustAccountDeposits = rootBank.getNativeTotalDeposit().sub(dustAccount.getNativeDeposit(rootBank, marketIndex));
  const nonDustAccountVaultBalance = vaultBalance - dustAccount.getNativeDeposit(rootBank, marketIndex).ceil().toNumber();
  console.log(`Market Mode: ${MarketMode[mangoGroup.tokens[marketIndex].spotMarketMode]}`)
  console.log(`Deposits are dust ${nonDustAccountDeposits.lt(ONE_I80F48) ? '✅' : `❎ - ${nonDustAccountDeposits}`}`);
  console.log(`Borrows are dust ${rootBank.getNativeTotalBorrow().lt(ONE_I80F48) ? '✅' : `❎ - ${rootBank.getNativeTotalBorrow()}`}`);
  console.log(`Vault balance is 0 ${nonDustAccountVaultBalance == 0 ? '✅' : `❎ - ${nonDustAccountVaultBalance}`}`);
  console.log(`All open orders accounts closed ${!hasOpenOrdersAccounts ? '✅' : '❎'}`);
}

checkSpotMarket();
