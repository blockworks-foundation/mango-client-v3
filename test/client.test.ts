/* eslint-disable @typescript-eslint/no-non-null-assertion, no-console */
import { Account } from '@solana/web3.js';
import { expect } from 'chai';
import * as Test from './utils';
import { MangoClient } from '../src';
import MangoGroup from '../src/MangoGroup';
import { QUOTE_INDEX } from '../src/layout';
import { sleep, zeroKey } from '../src/utils';
import MangoAccount from '../src/MangoAccount';

describe('MangoClient', async () => {
  let client: MangoClient;
  let payer: Account;
  const connection = Test.createDevnetConnection();

  before(async () => {
    client = new MangoClient(connection, Test.MangoProgramId);
    sleep(2000); // sleeping because devnet rate limits suck
    payer = await Test.createAccount(connection);
    sleep(2000); // sleeping because devnet rate limits suck
  });

  describe('initMangoGroup', async () => {
    it('should successfully create a MangoGroup', async () => {
      sleep(1000); // sleeping because devnet rate limits suck
      const groupKey = await client.initMangoGroup(
        Test.USDCMint,
        Test.MSRMMint,
        Test.DexProgramId,
        Test.FeesVault,
        5,
        0.7,
        0.06,
        1.5,
        payer,
      );
      const group = await client.getMangoGroup(groupKey);
      expect(groupKey).to.not.be.undefined;
      expect(group).to.not.be.undefined;
      expect(group.tokens[QUOTE_INDEX].mint.toBase58(), 'quoteMint').to.equal(
        Test.USDCMint.toBase58(),
      );
      expect(group.admin.toBase58(), 'admin').to.equal(
        payer.publicKey.toBase58(),
      );
      expect(group.dexProgramId.toBase58(), 'dexPerogramId').to.equal(
        Test.DexProgramId.toBase58(),
      );
    });
  });

  describe('cacheRootBanks', async () => {
    let group: MangoGroup;

    before(async () => {
      const groupKey = await client.initMangoGroup(
        Test.USDCMint,
        Test.MSRMMint,
        Test.DexProgramId,
        Test.FeesVault,
        5,
        0.7,
        0.06,
        1.5,
        payer,
      );
      group = await client.getMangoGroup(groupKey);
    });

    it('should successfully update the cache', async () => {
      const rootBankPks = group.tokens
        .filter((tokenInfo) => !tokenInfo.mint.equals(zeroKey))
        .map((tokenInfo) => tokenInfo.rootBank);

      await client.cacheRootBanks(
        group.publicKey,
        group.mangoCache,
        rootBankPks,
        payer,
      );
    });
  });

  describe.skip('initMangoAccount, deposit, and withdraw', async () => {
    let group: MangoGroup;
    let user: Account;
    let mangoAccount: MangoAccount;
    let userTokenAcc: Account;

    before(async () => {
      const groupKey = await client.initMangoGroup(
        Test.USDCMint,
        Test.MSRMMint,
        Test.DexProgramId,
        Test.FeesVault,
        5,
        0.7,
        0.06,
        1.5,
        payer,
      );
      group = await client.getMangoGroup(groupKey);
      user = await Test.createAccount(connection, 5);
      const mangoAccountPk = await client.initMangoAccount(group, user);
      mangoAccount = await client.getMangoAccount(
        mangoAccountPk,
        Test.DexProgramId,
      );
    });

    xit('deposit USDC and then WITHDRAW the USDC', async () => {
      const rootBanks = await group.loadRootBanks(client.connection);
      const usdcRootBank = rootBanks[QUOTE_INDEX];

      if (usdcRootBank) {
        const nodeBanks = await usdcRootBank.loadNodeBanks(client.connection);

        const filteredNodeBanks = nodeBanks.filter((nodeBank) => !!nodeBank);
        expect(filteredNodeBanks.length).to.equal(1);

        await client.deposit(
          group,
          mangoAccount,
          user,
          group.tokens[QUOTE_INDEX].rootBank,
          usdcRootBank.nodeBanks[0],
          filteredNodeBanks[0]!.vault,
          userTokenAcc.publicKey,
          10,
        );
      }
    });
  });
});
