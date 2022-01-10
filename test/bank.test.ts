/* eslint-disable @typescript-eslint/no-non-null-assertion, no-console */
import { expect } from 'chai';
import MangoGroup from '../src/MangoGroup';
import { loadTestMangoGroup, loadTestMangoNodeBank, loadTestMangoRootBank } from './testdata';
import { NodeBank, RootBank } from '../src';

describe('Root Banks and Interest Rates', async () => {
  before(async () => {
  });

  describe('root bank', async () => {
    it('loading the root bank from a file should load the correct values', async () => {
      const prefix = "./testdata/1deposit"
      const rootBank: RootBank = loadTestMangoRootBank(`${prefix}/root_bank0.json`)

      expect(rootBank.publicKey.toBase58()).to.equal("HUBX4iwWEUK5VrXXXcB7uhuKrfT4fpu2T9iZbg712JrN")
      expect(rootBank.optimalUtil.toString()).to.equal("0.69999999999999928946")
      expect(rootBank.optimalRate.toString()).to.equal("0.05999999999999872102")
      expect(rootBank.maxRate.toString()).to.equal("1.5")
      expect(rootBank.numNodeBanks.toString()).to.equal("1")
      expect(rootBank.depositIndex.toString()).to.equal("1000154.42276607355830719825")
      expect(rootBank.borrowIndex.toString()).to.equal("1000219.00867863010088498754")
      expect(rootBank.lastUpdated.toString(10)).to.equal("1633359485")
    });
  });

  describe('interest rates', async () => {
    it('BTC root bank should return correct interest rate', async () => {
      const prefix = "./testdata/tokenbank"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const rootBank: RootBank = loadTestMangoRootBank(`${prefix}/btc_root_bank.json`)
      const nodeBank: NodeBank = loadTestMangoNodeBank(`${prefix}/btc_node_bank.json`)
      rootBank.nodeBankAccounts = [nodeBank]

      expect(
        rootBank.getBorrowRate(mangoGroup)
          .toString()
      ).to.equal("0.0060962691428017024");

      expect(
        rootBank.getDepositRate(mangoGroup)
          .toString()
      ).to.equal("0.00074328994922723268");
    });

    it('USDC root bank should return correct interest rate', async () => {
      const prefix = "./testdata/tokenbank"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const rootBank: RootBank = loadTestMangoRootBank(`${prefix}/usdc_root_bank.json`)
      const nodeBank: NodeBank = loadTestMangoNodeBank(`${prefix}/usdc_node_bank.json`)
      rootBank.nodeBankAccounts = [nodeBank]

      expect(
        rootBank.getBorrowRate(mangoGroup)
          .toString()
      ).to.equal("0.23058349895659091544");

      expect(
        rootBank.getDepositRate(mangoGroup)
          .toString()
      ).to.equal("0.16874409787690680673");
    });
  });
});
