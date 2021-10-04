/* eslint-disable @typescript-eslint/no-non-null-assertion, no-console */
import { expect } from 'chai';
import MangoGroup from '../src/MangoGroup';
import MangoAccount from '../src/MangoAccount';
import { loadTestMangoAccount, loadTestMangoCache, loadTestMangoGroup } from './testdata';
import { MangoCache } from '../src';

describe('Health', async () => {
  before(async () => {
  });

  describe('empty', async () => {
    it('getHealth() should return correct result', async () => {
      const prefix = "./testdata/empty"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)
      const result = mangoAccount.getHealth(mangoGroup, mangoCache, 'Init')

      expect(
        result
          .toString()
      ).to.equal("0");
    });
  });

  describe('1deposit', async () => {
    it('getHealth() should return correct result', async () => {
      const prefix = "./testdata/1deposit"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)
      const result = mangoAccount.getHealth(mangoGroup, mangoCache, 'Init')

      expect(
        result
          .toString()
      ).to.equal("37904260000.05905822642118252475");
    });
  });

  describe('perpAccountNoSpotOpenorders', async () => {
    it('getHealth() should return correct result', async () => {
      const prefix = "./testdata/perp_account_no_spot_openorders"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)
      const result = mangoAccount.getHealth(mangoGroup, mangoCache, 'Init')

      expect(
        result
          .toString()
      ).to.equal("341025333625.51856223547208912805");
    });
  });

  describe('perpAccountNoSpotOpenordersUnhealthy', async () => {
    it('getHealth() should return correct result', async () => {
      const prefix = "./testdata/perp_account_no_spot_openorders_unhealthy"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)
      const result = mangoAccount.getHealth(mangoGroup, mangoCache, 'Init')

      expect(
        result
          .toString()
      ).to.equal("-848086876487.04950427436299875694");
    });
  });

  describe('account1', async () => {
    it('getHealth() should return correct result', async () => {
      const prefix = "./testdata/account1"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)
      const result = mangoAccount.getHealth(mangoGroup, mangoCache, 'Init')

      expect(
        result
          .toString()
      ).to.equal("454884281.15520619643754685058");
    });
  });

  describe('account2', async () => {
    it('getHealth() should return correct result', async () => {
      const prefix = "./testdata/account2"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)
      const result = mangoAccount.getHealth(mangoGroup, mangoCache, 'Init')

      expect(
        result
          .toString()
      ).to.equal("7516159604.84918334545095675026");
    });
  });
});
