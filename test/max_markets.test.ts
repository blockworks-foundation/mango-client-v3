/* eslint-disable @typescript-eslint/no-non-null-assertion, no-console */
import { Connection, Keypair, Account, PublicKey } from '@solana/web3.js';
import { Token } from '@solana/spl-token';
import { expect } from 'chai';
import * as Test from './utils';
import { MangoClient } from '../src';
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
      // Create mango group
      const mangoGroupPk = await client.initMangoGroup(
        Test.USDCMint,
        Test.MSRMMint,
        Test.DexProgramId,
        5,
        0.7,
        0.06,
        1.5,
        payer,
      );
      console.log("mangoGroupPk:", mangoGroupPk.toString());
      // Create mints
      const mints: Token[] = await Test.createMints(connection, payer, 2);
      // List spot markets
      const spotMarketPks = await Test.listMarkets(connection, payer, Test.DexProgramId, mints, Test.USDCMint);
      // Add markets to MangoGroup
      for (let spotMarketPk of spotMarketPks) {
        console.log("spotMarketPk:", spotMarketPk.toString());
      }
    });
  });
});
