/* eslint-disable @typescript-eslint/no-non-null-assertion, no-console */
import { Connection, Keypair, Account, PublicKey } from '@solana/web3.js';
import { expect } from 'chai';
import * as Test from './utils';
import { MangoClient } from '../src';
import MangoGroup, { QUOTE_INDEX } from '../src/MangoGroup';
import { sleep, zeroKey } from '../src/utils';
import MangoAccount from '../src/MangoAccount';
import { TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';

const createMints = async (connection: Connection, payer: Account, quantity: Number) => {
  const mints: Token[] = [];
  for (let i = 0; i < quantity; i++) {
    const mintAuthority = Keypair.generate().publicKey;
    const decimals = 6;
    mints.push(await Token.createMint(
      connection,
      payer,
      mintAuthority,
      null,
      decimals,
      TOKEN_PROGRAM_ID,
    ));
  }
  return mints;
}

describe('MaxMarkets', async () => {
  let client: MangoClient;
  let payer: Account;
  const connection = Test.createDevnetConnection();

  before(async () => {
    client = new MangoClient(connection, Test.MangoProgramId);
    payer = await Test.createAccount(connection, 50);
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
      const mints: Token[] = await createMints(connection, payer, 2);
      // List spot markets
      for (let mint of mints) {
        console.log("mintPk", mint.publicKey.toString());
        const spotMarketPk = await Test.listMarket(connection, payer, mint.publicKey, Test.USDCMint, 10, 100, Test.DexProgramId);
        console.log("spotMarketPk", spotMarketPk);
      }
    });
  });
});
