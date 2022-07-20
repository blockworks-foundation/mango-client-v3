import { Connection, PublicKey } from '@solana/web3.js';
import {
  IDS,
  MangoClient,
  MarketMode,
  nativeToUi,
  ONE_I80F48,
  TokenAccount,
  TokenAccountLayout,
  ZERO_BN,
  ZERO_I80F48,
} from '../..';
import { Cluster, Config, getSpotMarketConfig } from '../../config';

const config = new Config(IDS);

const cluster = (process.env.CLUSTER || 'mainnet') as Cluster;
const groupName = process.env.GROUP || 'mainnet.1';
const symbol = process.env.MARKET || 'LUNA';
const groupIds = config.getGroup(cluster, groupName)!;
const marketConfig = getSpotMarketConfig(groupIds, (x) => x.name.includes(symbol))!;
const marketIndex = marketConfig.marketIndex;

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
  let hasOpenOrdersAccountsCount = 0;
  let toLiquidate = 0;
  const vaultBalance = vaults.reduce((sum, v) => sum + v.amount, 0);
  console.log(vaults[0].publicKey.toBase58())

  for (const account of accounts) {
    if (!account.spotOpenOrders[marketIndex].equals(PublicKey.default)) {
      hasOpenOrdersAccounts = true;
      hasOpenOrdersAccountsCount++;
      //console.log('Account', account.publicKey.toBase58(), 'has open orders account', account.spotOpenOrders[marketIndex].toBase58());
    }

    if (!account.spotOpenOrders[marketIndex].equals(PublicKey.default) || !account.deposits[marketIndex].isZero() ||  !account.borrows[marketIndex].isZero()) {
      toLiquidate++;
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
  console.log(`Deposits are dust ${nonDustAccountDeposits.lt(ONE_I80F48) ? '✅' : `❎ - ${nativeToUi(nonDustAccountDeposits.toNumber(), marketConfig.baseDecimals)}`}`);
  console.log(`Borrows are dust ${rootBank.getNativeTotalBorrow().lt(ONE_I80F48) ? '✅' : `❎ - ${nativeToUi(rootBank.getNativeTotalBorrow().toNumber(), marketConfig.baseDecimals)}`}`);
  console.log(`Vault balance is 0 ${nonDustAccountVaultBalance == 0 ? '✅' : `❎ - ${nativeToUi(nonDustAccountVaultBalance, marketConfig.baseDecimals)}`}`);
  console.log(`All open orders accounts closed ${!hasOpenOrdersAccounts ? '✅' : `❎ - ${hasOpenOrdersAccountsCount}`}`);
  //console.log('Accounts to liquidate', toLiquidate)
}

checkSpotMarket();
