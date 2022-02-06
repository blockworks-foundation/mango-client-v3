import { Connection, PublicKey } from '@solana/web3.js';
import { MangoClient } from '../client';
import MangoAccount from '../MangoAccount';
import PerpMarket from '../PerpMarket';
import { getPerpMarketByIndex, getTokenByMint, GroupConfig } from '../config';
import { MangoCache, QUOTE_INDEX } from '../layout';
import { I80F48, ZERO_I80F48 } from '../utils/fixednum';
import { promiseUndef, ZERO_BN, zeroKey } from '../utils/utils';
import RootBank from '../RootBank';

async function setUp(client: MangoClient, mangoGroupKey: PublicKey) {
  const mangoGroup = await client.getMangoGroup(mangoGroupKey);
  const rootBanks = await mangoGroup.loadRootBanks(client.connection);
  const vaults = await Promise.all(
    rootBanks.map((rootBank) => {
      if (rootBank === undefined) {
        return promiseUndef();
      } else {
        // Assumes only one node bank; Fix if we add more node bank
        return client.connection.getTokenAccountBalance(
          rootBank.nodeBankAccounts[0].vault,
        );
      }
    }),
  );

  const mangoAccounts = await client.getAllMangoAccounts(
    mangoGroup,
    undefined,
    true,
  );

  const mangoCache = await mangoGroup.loadCache(client.connection);
  const perpMarkets: (PerpMarket | undefined)[] = await Promise.all(
    mangoGroup.perpMarkets.map((pmi, i) =>
      pmi.isEmpty()
        ? undefined
        : client.getPerpMarket(
            pmi.perpMarket,
            mangoGroup.tokens[i].decimals,
            mangoGroup.tokens[QUOTE_INDEX].decimals,
          ),
    ),
  );

  return { mangoGroup, mangoCache, vaults, mangoAccounts, perpMarkets };
}

function checkSumOfBasePositions(
  groupConfig: GroupConfig,
  mangoCache: MangoCache,
  mangoAccounts: MangoAccount[],
  perpMarkets: (PerpMarket | undefined)[],
) {
  let totalBase = ZERO_BN;
  let totalQuote = ZERO_I80F48;

  for (let i = 0; i < QUOTE_INDEX; i++) {
    if (perpMarkets[i] === undefined) {
      continue;
    }
    const perpMarket = perpMarkets[i] as PerpMarket;
    let sumOfAllBasePositions = ZERO_BN;
    let absBasePositions = ZERO_BN;
    let sumQuote = perpMarket.feesAccrued;
    const perpMarketCache = mangoCache.perpMarketCache[i];
    for (const mangoAccount of mangoAccounts) {
      const perpAccount = mangoAccount.perpAccounts[i];
      sumOfAllBasePositions = sumOfAllBasePositions.add(
        perpAccount.basePosition,
      );
      absBasePositions = absBasePositions.add(perpAccount.basePosition.abs());
      sumQuote = sumQuote.add(perpAccount.getQuotePosition(perpMarketCache));
    }

    console.log(
      `Market: ${getPerpMarketByIndex(groupConfig, i)?.name}
      Sum Base Pos: ${sumOfAllBasePositions.toString()}
      Sum Abs Base Pos ${absBasePositions.toString()}
      Open Interest: ${perpMarket.openInterest.toString()}
      Sum Quote: ${sumQuote.toString()}\n`,
    );

    totalBase = totalBase.add(sumOfAllBasePositions);
    totalQuote = totalQuote.add(sumQuote);
  }

  console.log(
    `Total Base: ${totalBase.toString()}\nTotal Quote: ${totalQuote.toString()}`,
  );
}

async function checkSumOfNetDeposit(
  groupConfig,
  connection,
  mangoGroup,
  mangoCache,
  vaults,
  mangoAccounts,
) {
  for (let i = 0; i < mangoGroup.tokens.length; i++) {
    if (mangoGroup.tokens[i].mint.equals(zeroKey)) {
      continue;
    }
    console.log('======');
    console.log(getTokenByMint(groupConfig, mangoGroup.tokens[i].mint)?.symbol);
    console.log(
      'deposit index',
      mangoCache.rootBankCache[i].depositIndex.toString(),
    );
    console.log(
      'borrow index',
      mangoCache.rootBankCache[i].borrowIndex.toString(),
    );

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

    const rootBank = mangoGroup.rootBankAccounts[i] as RootBank;
    let vaultAmount = ZERO_I80F48;
    if (rootBank) {
      const nodeBanks = rootBank.nodeBankAccounts;
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
      vaultAmount = I80F48.fromString(vaults[i].value.amount);

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
}

export default async function sanityCheck(
  connection: Connection,
  groupConfig: GroupConfig,
) {
  const client = new MangoClient(connection, groupConfig.mangoProgramId);
  const { mangoGroup, mangoCache, vaults, mangoAccounts, perpMarkets } =
    await setUp(client, groupConfig.publicKey);
  checkSumOfBasePositions(groupConfig, mangoCache, mangoAccounts, perpMarkets);
  await checkSumOfNetDeposit(
    groupConfig,
    connection,
    mangoGroup,
    mangoCache,
    vaults,
    mangoAccounts,
  );
}
