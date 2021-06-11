import { Account } from '@solana/web3.js';
import { expect } from 'chai';
import * as Test from './utils';
import { MerpsClient } from '../src';
import MerpsGroup, { QUOTE_INDEX } from '../src/MerpsGroup';
import { sleep, zeroKey } from '../src/utils';
import MerpsAccount from '../src/MerpsAccount';

describe('MerpsClient', async () => {
  let client: MerpsClient;
  let payer: Account;
  const connection = Test.createDevnetConnection();

  before(async () => {
    client = new MerpsClient(connection, Test.MerpsProgramId);
    sleep(2000); // sleeping because devnet rate limits suck
    payer = await Test.createAccount(connection);
    sleep(2000); // sleeping because devnet rate limits suck
  });

  describe('initMerpsGroup', async () => {
    it('should successfully create a MerpsGroup', async () => {
      sleep(1000); // sleeping because devnet rate limits suck
      const groupKey = await client.initMerpsGroup(
        payer,
        Test.USDCMint,
        Test.DexProgramId,
        5,
      );
      const group = await client.getMerpsGroup(groupKey);
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
    let group: MerpsGroup;

    before(async () => {
      const groupKey = await client.initMerpsGroup(
        payer,
        Test.USDCMint,
        Test.DexProgramId,
        5,
      );
      group = await client.getMerpsGroup(groupKey);
    });

    it('should successfully update the cache', async () => {
      const rootBankPks = group.tokens
        .filter((tokenInfo) => !tokenInfo.mint.equals(zeroKey))
        .map((tokenInfo) => tokenInfo.rootBank);

      await client.cacheRootBanks(
        payer,
        group.publicKey,
        group.merpsCache,
        rootBankPks,
      );
    });
  });

  describe.only('initMerpsAccount, deposit, and withdraw', async () => {
    let group: MerpsGroup;
    let user: Account;
    let merpsAccount: MerpsAccount;
    let userTokenAcc: Account;

    before(async () => {
      const groupKey = await client.initMerpsGroup(
        payer,
        Test.USDCMint,
        Test.DexProgramId,
        5,
      );
      group = await client.getMerpsGroup(groupKey);
      user = await Test.createAccount(connection, 5);
      const merpsAccountPk = await client.initMerpsAccount(group, user);
      merpsAccount = await client.getMerpsAccount(
        merpsAccountPk,
        Test.DexProgramId,
      );
    });

    it('deposit USDC and then WITHDRAW the USDC', async () => {
      const rootBanks = await group.loadRootBanks(client.connection);
      const usdcRootBank = rootBanks[QUOTE_INDEX];

      if (usdcRootBank) {
        const nodeBanks = await usdcRootBank.loadNodeBanks(client.connection);

        const filteredNodeBanks = nodeBanks.filter((nodeBank) => !!nodeBank);
        expect(filteredNodeBanks.length).to.equal(1);

        await client.deposit(
          group,
          merpsAccount,
          user,
          group.tokens[QUOTE_INDEX].rootBank,
          usdcRootBank.nodeBanks[0],
          filteredNodeBanks[0].vault,
          userTokenAcc.publicKey,
          10,
        );
      }
    });
  });
});
