import { Connection } from '@solana/web3.js';
import { MangoClient } from '../client';
import MangoAccount from '../MangoAccount';
import PerpMarket from '../PerpMarket';
import { GroupConfig } from '../config';
import { QUOTE_INDEX } from '../layout';
import { I80F48, ZERO_I80F48 } from '../fixednum';
import { zeroKey } from '../utils';

const setUp = async (client, mangoGroupKey) => {
  const mangoGroup = await client.getMangoGroup(mangoGroupKey);
  const mangoAccounts = await client.getAllMangoAccounts(
    mangoGroup,
    undefined,
    true,
  );
  const perpMarkets: PerpMarket[] = [];
  for (let i = 0; i < QUOTE_INDEX; i++) {
    const perpMarketInfo = mangoGroup.perpMarkets[i];
    const perpMarket = await client.getPerpMarket(
      perpMarketInfo.perpMarket,
      mangoGroup.tokens[i].decimals,
      mangoGroup.tokens[QUOTE_INDEX].decimals,
    );
    perpMarkets.push(perpMarket);
  }
  return { mangoGroup, mangoAccounts, perpMarkets };
};

const checkSumOfBasePositions = async (mangoAccounts: MangoAccount[]) => {
  const sumOfAllBasePositions = mangoAccounts.reduce((sumAll, mangoAccount) => {
    const sumOfBasePositions = mangoAccount.perpAccounts.reduce(
      (sum, perpAccount) => {
        return sum + perpAccount.basePosition.toNumber();
      },
      0,
    );
    return sumAll + sumOfBasePositions;
  }, 0);
  console.log('checkSumOfBasePositions', sumOfAllBasePositions);
};

const checkSumOfQuotePositions = async (
  connection,
  mangoGroup,
  mangoAccounts,
  perpMarkets,
) => {
  const mangoCache = await mangoGroup.loadCache(connection);
  const sumOfAllQuotePositions = mangoAccounts.reduce(
    (sumAll, mangoAccount) => {
      const sumOfQuotePositions = mangoAccount.perpAccounts.reduce(
        (sum, perpAccount, index) => {
          const perpMarketCache = mangoCache.perpMarketCache[index];
          return sum.add(perpAccount.getQuotePosition(perpMarketCache));
        },
        ZERO_I80F48,
      );
      return sumAll.add(sumOfQuotePositions);
    },
    ZERO_I80F48,
  );

  const sumOfFeesAccrued = perpMarkets.reduce((sum, perpMarket) => {
    return sum.add(perpMarket.feesAccrued);
  }, ZERO_I80F48);

  console.log(
    'checkSumOfQuotePositions:',
    sumOfAllQuotePositions.add(sumOfFeesAccrued).toString(),
  );
};

const checkSumOfNetDeposit = async (connection, mangoGroup, mangoAccounts) => {
  const mangoCache = await mangoGroup.loadCache(connection);
  const rootBanks = await mangoGroup.loadRootBanks(connection);
  for (let i = 0; i < mangoGroup.tokens.length; i++) {
    if (mangoGroup.tokens[i].mint.equals(zeroKey)) {
      continue;
    }

    console.log('======');
    const sumOfNetDepositsAcrossMAs = mangoAccounts.reduce(
      (sum, mangoAccount) => {
        return sum.add(mangoAccount.getNet(mangoCache.rootBankCache[i], i));
      },
      ZERO_I80F48,
    );
    console.log(
      'sumOfNetDepositsAcrossMAs:',
      sumOfNetDepositsAcrossMAs.toString(),
    );

    let vaultAmount = ZERO_I80F48;
    const rootBank = rootBanks[i];
    if (rootBank) {
      const nodeBanks = await rootBanks[i].loadNodeBanks(connection);
      const sumOfNetDepositsAcrossNodes = nodeBanks.reduce((sum, nodeBank) => {
        return sum.add(
          nodeBank.deposits.mul(mangoCache.rootBankCache[i].depositIndex),
        );
      }, ZERO_I80F48);
      const sumOfNetBorrowsAcrossNodes = nodeBanks.reduce((sum, nodeBank) => {
        return sum.add(
          nodeBank.borrows.mul(mangoCache.rootBankCache[i].borrowIndex),
        );
      }, ZERO_I80F48);
      console.log(
        'sumOfNetDepositsAcrossNodes:',
        sumOfNetDepositsAcrossNodes.toString(),
      );
      console.log(
        'sumOfNetBorrowsAcrossNodes:',
        sumOfNetBorrowsAcrossNodes.toString(),
      );

      for (let j = 0; j < nodeBanks.length; j++) {
        const vault = await connection.getTokenAccountBalance(
          nodeBanks[j].vault,
        );
        vaultAmount = vaultAmount.add(I80F48.fromString(vault.value.amount));
      }
      console.log('vaultAmount:', vaultAmount.toString());

      console.log(
        'nodesDiff:',
        vaultAmount
          .sub(sumOfNetDepositsAcrossNodes)
          .add(sumOfNetBorrowsAcrossNodes)
          .toString(),
      );
    }

    console.log('Diff', vaultAmount.sub(sumOfNetDepositsAcrossMAs).toString());
  }
};

export default async function sanityCheck(
  connection: Connection,
  groupConfig: GroupConfig,
) {
  const client = new MangoClient(connection, groupConfig.mangoProgramId);
  const { mangoGroup, mangoAccounts, perpMarkets } = await setUp(
    client,
    groupConfig.publicKey,
  );
  await checkSumOfBasePositions(mangoAccounts);
  await checkSumOfQuotePositions(
    connection,
    mangoGroup,
    mangoAccounts,
    perpMarkets,
  );
  await checkSumOfNetDeposit(connection, mangoGroup, mangoAccounts);
}
