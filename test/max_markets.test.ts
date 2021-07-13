/* eslint-disable @typescript-eslint/no-non-null-assertion, no-console */
import { Connection, Keypair, Account, PublicKey } from '@solana/web3.js';
import { Token } from '@solana/spl-token';
import { expect } from 'chai';
import * as Test from './utils';
import { MangoClient } from '../src';
import MangoGroup, { QUOTE_INDEX } from '../src/MangoGroup';
import { sleep, zeroKey } from '../src/utils';
import MangoAccount from '../src/MangoAccount';

const MAX_RATE = 1.5;
const OPTIMAL_UTIL = 0.7;
const OPTIMAL_RATE = 0.06;

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
      const mangoGroup = await client.getMangoGroup(mangoGroupPk);
      console.log("mangoGroupPk:", mangoGroupPk.toString());
      const num = 2;
      // Create mints
      const mints: Token[] = await Test.createMints(connection, payer, num);
      // List spot markets
      const spotMarketPks = await Test.listMarkets(connection, payer, Test.DexProgramId, mints, Test.USDCMint);
      // Add markets to MangoGroup
      for (let i = 0; i < num; i++) {
        const mint = mints[i];
        const spotMarketPk = spotMarketPks[i];

        const oraclePk = await Test.createOracle(connection, Test.MangoProgramId, payer);
        try {
          await client.addOracle(mangoGroup, oraclePk, payer);
        } catch (err) {
          console.log(err);
          // TODO: In mango-v3 program code
          // the add_oracle expects oracle_ai to writeable but it's not
          // We need it to be writeable to add our magic bytes
          // If that will mess up Pyth oracle addition
          // We need 2 add_oracle fns in processor.rs - add_stub_oracle and add_oracle
        }

        // TODO: Set oracle to whatever is necessary

        const initLeverage = 5;
        const maintLeverage = initLeverage * 2;
        console.log("spotMarketPk:", spotMarketPk.toString());
        await client.addSpotMarket(
          mangoGroup,
          spotMarketPk,
          mint.publicKey,
          payer,
          i,
          maintLeverage,
          initLeverage,
          OPTIMAL_UTIL,
          OPTIMAL_RATE,
          MAX_RATE,
        );
      }
    });
  });
});
