/* eslint-disable @typescript-eslint/no-non-null-assertion, no-console */
import { Account, Connection } from '@solana/web3.js';
import { Token } from '@solana/spl-token';
import * as Test from './utils';
import { MangoClient } from '../src';
import { QUOTE_INDEX } from '../src/layout';

// NOTE: Important that QUOTE_INDEX and quote_index might not be the same number so take caution there

describe('MaxMarkets', async () => {
  let client: MangoClient;
  let payer: Account;
  const connection: Connection = Test.createDevnetConnection();

  before(async () => {
    client = new MangoClient(connection, Test.MangoProgramId);
    payer = await Test.createAccount(connection, 10);
  });

  describe('testOrdersX32', async () => {
    it('should successfully place x32 orders', async () => {
      // Initial conf
      const numMints = 2;
      const quoteIndex = numMints - 1;
      const marketIndex = 0;
      // Create mints
      const mints: Token[] = await Test.createMints(
        connection,
        payer,
        numMints,
      );
      const quoteMint = mints[quoteIndex];
      if (!quoteMint) throw new Error('Failed creating mints');

      // Create mango group
      const mangoGroupPk = await client.initMangoGroup(
        quoteMint.publicKey,
        Test.MSRMMint,
        Test.DexProgramId,
        Test.FeesVault,
        5,
        Test.OPTIMAL_UTIL,
        Test.OPTIMAL_RATE,
        Test.MAX_RATE,
        payer,
      );
      let mangoGroup = await client.getMangoGroup(mangoGroupPk);

      // Create mango account
      const mangoAccountPk = await client.initMangoAccount(mangoGroup, payer);
      let mangoAccount = await client.getMangoAccount(
        mangoAccountPk,
        Test.DexProgramId,
      );

      // List spot markets
      const spotMarketPks = await Test.listMarkets(
        connection,
        payer,
        Test.DexProgramId,
        mints,
        quoteMint.publicKey,
      );

      // Add associated token accounts to user and mint some
      const tokenAccountPks = await Test.createUserTokenAccounts(
        payer,
        mints,
        new Array(mints.length).fill(1_000_000),
      );

      // Add spotMarkets to MangoGroup
      mangoGroup = await Test.addSpotMarketsToMangoGroup(
        client,
        payer,
        mangoGroupPk,
        mints,
        spotMarketPks,
      );

      // Get root and node banks
      const quoteNodeBank = await Test.getNodeBank(
        client,
        mangoGroup,
        QUOTE_INDEX,
      );
      const baseNodeBank = await Test.getNodeBank(
        client,
        mangoGroup,
        marketIndex,
      );

      // Airdrop into base node bank
      await Test.mintToTokenAccount(payer, mints[0], baseNodeBank.vault, 10);

      // Deposit into mango account
      await Test.cacheRootBanks(client, payer, mangoGroup, [
        marketIndex,
        QUOTE_INDEX,
      ]);

      mangoAccount = await Test.performDeposit(
        client,
        payer,
        mangoGroup,
        mangoAccount,
        quoteNodeBank,
        tokenAccountPks[quoteIndex],
        QUOTE_INDEX,
        1_000_000,
      );

      await Test.cachePrices(client, payer, mangoGroup, [marketIndex]);

      const market = await Test.getMarket(client, mangoGroup, 0);

      mangoAccount = await Test.placeSpotOrder(
        client,
        payer,
        mangoGroup,
        mangoAccount,
        market,
      );
    });
  });
});
