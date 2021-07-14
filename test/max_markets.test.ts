/* eslint-disable @typescript-eslint/no-non-null-assertion, no-console */
import { Connection, Keypair, Account, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import { expect } from 'chai';
import * as Test from './utils';
import { MangoClient } from '../src';
import { I80F48 } from '../src';
import MangoGroup, { QUOTE_INDEX } from '../src/MangoGroup';
import { sleep, zeroKey } from '../src/utils';
import MangoAccount from '../src/MangoAccount';

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
      const mints: Token[] = await Test.createMints(connection, payer, numMints);
      const quoteMint = mints[quoteIndex];
      if (!quoteMint) throw new Error("Failed creating mints");

      // Create mango group
      const mangoGroupPk = await client.initMangoGroup(
        quoteMint.publicKey,
        Test.MSRMMint,
        Test.DexProgramId,
        5,
        Test.OPTIMAL_UTIL,
        Test.OPTIMAL_RATE,
        Test.MAX_RATE,
        payer,
      );
      let mangoGroup = await client.getMangoGroup(mangoGroupPk);
      console.log("mangoGroupPk:", mangoGroupPk.toString());

      // Create mango account
      const mangoAccountPk = await client.initMangoAccount(mangoGroup, payer);
      let mangoAccount = await client.getMangoAccount(mangoAccountPk, Test.DexProgramId);

      // List spot markets
      const spotMarketPks = await Test.listMarkets(connection, payer, Test.DexProgramId, mints, quoteMint.publicKey);

      // Add associated token accounts to user and mint some
      const tokenAccountPks = await Test.createUserTokenAccounts(payer, mints, new Array(mints.length).fill(1));

      // Add spotMarkets to MangoGroup
      mangoGroup = await Test.addSpotMarketsToMangoGroup(connection, client, payer, mangoGroupPk, mints, spotMarketPks);

      // Get root and node banks
      let rootBanks = await mangoGroup.loadRootBanks(client.connection);
      const usdcRootBank = rootBanks[QUOTE_INDEX];
      if (!usdcRootBank) throw new Error('no root bank for quote');
      const quoteNodeBank = usdcRootBank.nodeBankAccounts[0];
      const baseRootBank = rootBanks[marketIndex];
      if (!baseRootBank) throw new Error('no root bank for base');
      const baseNodeBank = baseRootBank.nodeBankAccounts[0];

      // Airdrop in to base node bank
      await mints[0].mintTo(baseNodeBank.vault, payer, [], 10 * 1e6);

      // Deposit into mango account
      await client.cacheRootBanks(
        mangoGroup.publicKey,
        mangoGroup.mangoCache,
        [
          mangoGroup.tokens[marketIndex].rootBank,
          mangoGroup.tokens[QUOTE_INDEX].rootBank,
        ],
        payer,
      );
      await client.deposit(
        mangoGroup,
        mangoAccount,
        payer,
        mangoGroup.tokens[QUOTE_INDEX].rootBank,
        usdcRootBank.nodeBanks?.[0],
        quoteNodeBank.vault,
        tokenAccountPks[quoteIndex],
        1, // quantity
      );
    });
  });
});
