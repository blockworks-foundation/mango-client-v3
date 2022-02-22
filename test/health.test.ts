/* eslint-disable @typescript-eslint/no-non-null-assertion, no-console */
import { expect } from 'chai';
import MangoGroup from '../src/MangoGroup';
import MangoAccount from '../src/MangoAccount';
import { loadTestMangoAccount, loadTestMangoCache, loadTestMangoGroup, loadTestOpenOrders } from './testdata';
import { MangoCache } from '../src';

describe('Health', async () => {
  before(async () => {
  });

  describe('empty', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/empty"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)

      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("0");
      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("0");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("100");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("100");
      expect(
        mangoAccount.computeValue(mangoGroup, mangoCache).toString()
      ).to.equal("0");
      expect(
        mangoAccount.getLeverage(mangoGroup, mangoCache).toString()
      ).to.equal("0");
      expect(mangoAccount.isLiquidatable(mangoGroup, mangoCache)).to.be.false
    });
  });

  describe('1deposit', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/1deposit"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)

      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("37904260000.05905822642118252475");
      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("42642292500.06652466908819931746");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("100");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("100");
      expect(
        mangoAccount.computeValue(mangoGroup, mangoCache).toString()
      ).to.equal("47380.32499999999999928946");
      expect(
        mangoAccount.getLeverage(mangoGroup, mangoCache).toString()
      ).to.equal("0");
      expect(mangoAccount.isLiquidatable(mangoGroup, mangoCache)).to.be.false
    });
  });

  describe('account1', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/account1"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      mangoAccount.spotOpenOrdersAccounts[3] = loadTestOpenOrders(`${prefix}/openorders3.json`)
      mangoAccount.spotOpenOrdersAccounts[6] = loadTestOpenOrders(`${prefix}/openorders6.json`)
      mangoAccount.spotOpenOrdersAccounts[7] = loadTestOpenOrders(`${prefix}/openorders7.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)

      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("454884281.15520619643754685058");
      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("901472688.63722587052636470162");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("10.48860467608925262084");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("20.785925232226531989");
      expect(
        mangoAccount.computeValue(mangoGroup, mangoCache).toString()
      ).to.equal("1348.25066158888197520582");
      expect(
        mangoAccount.getLeverage(mangoGroup, mangoCache).toString()
      ).to.equal("3.21671490144456129201");
      expect(mangoAccount.isLiquidatable(mangoGroup, mangoCache)).to.be.false
    });
  });

  describe('account2', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/account2"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      mangoAccount.spotOpenOrdersAccounts[2] = loadTestOpenOrders(`${prefix}/openorders2.json`)
      mangoAccount.spotOpenOrdersAccounts[3] = loadTestOpenOrders(`${prefix}/openorders3.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)

      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("7516159604.84918334545095675026");
      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("9618709877.45119083596852505025");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("24.80680004365716229131");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("31.74618756817508824497");
      expect(
        mangoAccount.computeValue(mangoGroup, mangoCache).toString()
      ).to.equal("11721.35669142618275273549");
      expect(
        mangoAccount.getLeverage(mangoGroup, mangoCache).toString()
      ).to.equal("3.56338611204225585993");
      expect(mangoAccount.isLiquidatable(mangoGroup, mangoCache)).to.be.false
    });
  });

  describe('account3', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/account3"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)

      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("341025333625.51856223547208912805");
      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("683477170424.20340250929429970483");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("4.52652018845647319267");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("9.50397353076404272088");
      expect(
        mangoAccount.computeValue(mangoGroup, mangoCache).toString()
      ).to.equal("1025929.00722205438034961844");
      expect(
        mangoAccount.getLeverage(mangoGroup, mangoCache).toString()
      ).to.equal("6.50157472788435697453");
      expect(mangoAccount.isLiquidatable(mangoGroup, mangoCache)).to.be.false
    });
  });

  describe('account4', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/account4"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)

      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("-848086876487.04950427436299875694");
      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("-433869053006.07361789143756070075");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("-9.30655353087566084014");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("-4.98781798472691662028");
      expect(
        mangoAccount.computeValue(mangoGroup, mangoCache).toString()
      ).to.equal("-19651.22952604663374742699");
      expect(
        mangoAccount.getLeverage(mangoGroup, mangoCache).toString()
      ).to.equal("-421.56937094643044972031");
      expect(mangoAccount.isLiquidatable(mangoGroup, mangoCache)).to.be.true
    });
  });

  describe('account5', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/account5"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      mangoAccount.spotOpenOrdersAccounts[0] = loadTestOpenOrders(`${prefix}/openorders0.json`)
      mangoAccount.spotOpenOrdersAccounts[1] = loadTestOpenOrders(`${prefix}/openorders1.json`)
      mangoAccount.spotOpenOrdersAccounts[2] = loadTestOpenOrders(`${prefix}/openorders2.json`)
      mangoAccount.spotOpenOrdersAccounts[3] = loadTestOpenOrders(`${prefix}/openorders3.json`)
      mangoAccount.spotOpenOrdersAccounts[8] = loadTestOpenOrders(`${prefix}/openorders8.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)

      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("15144959918141.09175135195858530324");
      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("15361719060997.68276021614036608298");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("878.88913077823325181726");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("946.44498820888003365326");
      expect(
        mangoAccount.computeValue(mangoGroup, mangoCache).toString()
      ).to.equal("15578478.17337437202354522015");
      expect(
        mangoAccount.getLeverage(mangoGroup, mangoCache).toString()
      ).to.equal("0.09884076560217636143");
      expect(mangoAccount.isLiquidatable(mangoGroup, mangoCache)).to.be.false
    });
  });

  describe('account6', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/account6"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      mangoAccount.spotOpenOrdersAccounts[0] = loadTestOpenOrders(`${prefix}/openorders0.json`)
      mangoAccount.spotOpenOrdersAccounts[1] = loadTestOpenOrders(`${prefix}/openorders1.json`)
      mangoAccount.spotOpenOrdersAccounts[2] = loadTestOpenOrders(`${prefix}/openorders2.json`)
      mangoAccount.spotOpenOrdersAccounts[3] = loadTestOpenOrders(`${prefix}/openorders3.json`)
      mangoAccount.spotOpenOrdersAccounts[8] = loadTestOpenOrders(`${prefix}/openorders8.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)

      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("14480970069238.33686487450164648294");
      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("15030566251990.17026082618337312624");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("215.03167137712999590349");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("236.77769605824430243501");
      expect(
        mangoAccount.computeValue(mangoGroup, mangoCache).toString()
      ).to.equal("15580162.40781940827396567784");
      expect(
        mangoAccount.getLeverage(mangoGroup, mangoCache).toString()
      ).to.equal("0.07913870989902704878");
      expect(mangoAccount.isLiquidatable(mangoGroup, mangoCache)).to.be.false
    });
  });

  describe('account7', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/account7"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      mangoAccount.spotOpenOrdersAccounts[3] = loadTestOpenOrders(`${prefix}/openorders3.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)

      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("16272272.28055547965738014682");
      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("16649749.17384252860704663135");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("359.23329723261616663876");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("400.98177879921834687593");
      expect(
        mangoAccount.computeValue(mangoGroup, mangoCache).toString()
      ).to.equal("17.02722595090433088671");
      expect(
        mangoAccount.getLeverage(mangoGroup, mangoCache).toString()
      ).to.equal("0.22169019545401269511");
      expect(mangoAccount.isLiquidatable(mangoGroup, mangoCache)).to.be.false
    });
  });

  describe('account8', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/account8"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      mangoAccount.spotOpenOrdersAccounts[3] = loadTestOpenOrders(`${prefix}/openorders3.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)

      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("337240882.73863372865950083224");
      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("496326340.62213476397751321656");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("36.05147100711967311781");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("53.05790488301020957351");
      expect(
        mangoAccount.computeValue(mangoGroup, mangoCache).toString()
      ).to.equal("655.41179779906788382959");
      expect(
        mangoAccount.getLeverage(mangoGroup, mangoCache).toString()
      ).to.equal("1.42725960097346415978");
      expect(mangoAccount.isLiquidatable(mangoGroup, mangoCache)).to.be.false
    });
  });

  describe('account9', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/account9"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      mangoAccount.spotOpenOrdersAccounts[1] = loadTestOpenOrders(`${prefix}/openorders1.json`)
      mangoAccount.spotOpenOrdersAccounts[5] = loadTestOpenOrders(`${prefix}/openorders5.json`)
      mangoAccount.spotOpenOrdersAccounts[6] = loadTestOpenOrders(`${prefix}/openorders6.json`)
      mangoAccount.spotOpenOrdersAccounts[10] = loadTestOpenOrders(`${prefix}/openorders10.json`)
      mangoAccount.spotOpenOrdersAccounts[11] = loadTestOpenOrders(`${prefix}/openorders11.json`)
      mangoAccount.spotOpenOrdersAccounts[12] = loadTestOpenOrders(`${prefix}/openorders12.json`)
      mangoAccount.spotOpenOrdersAccounts[13] = loadTestOpenOrders(`${prefix}/openorders13.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)

      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("96257596.93294236504926786324");
      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("511619124.36291981710078502488");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("2.97693824341962454127");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("17.21126913561050741919");
      expect(
        mangoAccount.computeValue(mangoGroup, mangoCache).toString()
      ).to.equal("926.98053240315212875089");
      expect(
        mangoAccount.getLeverage(mangoGroup, mangoCache).toString()
      ).to.equal("3.91944283828893702548");
      expect(mangoAccount.isLiquidatable(mangoGroup, mangoCache)).to.be.false
    });
  });
});
