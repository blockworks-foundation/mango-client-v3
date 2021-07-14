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

      // Create mango account
      const mangoAccountPk = await client.initMangoAccount(mangoGroup, payer);
      let mangoAccount = await client.getMangoAccount(mangoAccountPk, Test.DexProgramId);

      // List spot markets
      const spotMarketPks = await Test.listMarkets(connection, payer, Test.DexProgramId, mints, quoteMint.publicKey);

      // Add associated token accounts to user and mint some
      const tokenAccountPks = await Test.createUserTokenAccounts(payer, mints, new Array(mints.length).fill(1));

      // Add spotMarkets to MangoGroup
      mangoGroup = await Test.addSpotMarketsToMangoGroup(client, payer, mangoGroupPk, mints, spotMarketPks);

      // Get node banks
      const quoteNodeBank = await Test.getNodeBank(client, mangoGroup, QUOTE_INDEX);
      const baseNodeBank = await Test.getNodeBank(client, mangoGroup, marketIndex);

      // Airdrop into base node bank
      await Test.mintToTokenAccount(payer, mints[0], baseNodeBank.vault, 10);

      // Deposit into mango account
      await Test.cacheRootBanks(client, payer, mangoGroup, [marketIndex, QUOTE_INDEX]);
      await Test.performDeposit(client, payer, mangoGroup, mangoAccount, quoteNodeBank, tokenAccountPks[quoteIndex], QUOTE_INDEX, 1);

    });
  });
});
