import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import { MangoClient } from './client';
import MangoAccount from './MangoAccount';
import PerpMarket from './PerpMarket';
import configFile from './ids.json';
import { Cluster, Config } from './config';
import { QUOTE_INDEX } from './layout';
import { ZERO_I80F48 } from './fixednum';

const config = new Config(configFile);
const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
const groupName = process.env.GROUP || 'devnet.1';
const groupIds = config.getGroup(cluster, groupName);
if (!groupIds) {
  throw new Error(`Group ${groupName} not found`);
}
const mangoProgramId = groupIds.mangoProgramId;
const mangoGroupKey = groupIds.publicKey;

const connection = new Connection(
  config.cluster_urls[cluster],
  'processed' as Commitment,
);
const client = new MangoClient(connection, mangoProgramId);

const setUp = async () => {
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

const main = async () => {
  const { mangoGroup, mangoAccounts, perpMarkets } = await setUp();
  await checkSumOfBasePositions(mangoAccounts);
  await checkSumOfQuotePositions(mangoGroup, mangoAccounts, perpMarkets);
};

main();
