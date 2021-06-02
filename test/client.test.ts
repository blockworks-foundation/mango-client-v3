import { Account } from '@solana/web3.js';
import { expect } from 'chai';
import * as Test from './utils';
import { MerpsClient } from '../src';
import MerpsGroup from '../src/MerpsGroup';

describe('MerpsClient', async () => {
  let client: MerpsClient;
  let payer: Account;

  before(async () => {
    const connection = Test.createDevnetConnection();
    client = new MerpsClient(connection, Test.MerpsProgramId);
    payer = await Test.createAccount(connection);
  });

  describe('initMerpsGroup', async () => {
    it('should successfully create a MerpsGroup', async () => {
      const groupKey = await client.initMerpsGroup(
        payer,
        Test.USDCMint,
        Test.DexProgramId,
        5,
      );
      const group = await client.getMerpsGroup(groupKey);
      expect(groupKey).to.not.be.undefined;
      expect(group).to.not.be.undefined;
      expect(group.tokens[0].toBase58(), 'quoteMint').to.equal(
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
      const txid = await client.cacheRootBanks(
        payer,
        group.publicKey,
        group.merpsCache,
      );
    });
  });
});
