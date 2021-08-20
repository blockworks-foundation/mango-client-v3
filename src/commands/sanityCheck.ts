import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import { MangoClient } from '../client';
import MangoAccount from '../MangoAccount';
import PerpMarket from '../PerpMarket';
import { GroupConfig } from '../config';
import { QUOTE_INDEX } from '../layout';
import { ZERO_I80F48 } from '../fixednum';

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
      console.log(mangoAccount.publicKey.toString());
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

export default async function sanityCheck(
  connection: Connection,
  groupConfig: GroupConfig,
) {
  const client = new MangoClient(connection, groupConfig.mangoProgramId);
  const { mangoGroup, mangoAccounts, perpMarkets } = await setUp(client, groupConfig.publicKey);
  await checkSumOfBasePositions(mangoAccounts);
  await checkSumOfQuotePositions(connection, mangoGroup, mangoAccounts, perpMarkets);
};
