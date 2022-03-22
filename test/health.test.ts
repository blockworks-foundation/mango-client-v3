/* eslint-disable @typescript-eslint/no-non-null-assertion, no-console */
import { expect } from 'chai';
import MangoGroup from '../src/MangoGroup';
import MangoAccount from '../src/MangoAccount';
import { loadTestMangoAccount, loadTestMangoCache, loadTestMangoGroup, loadTestOpenOrders } from './testdata';
import { MangoCache, QUOTE_INDEX } from '../src';
import {
  nativeI80F48ToUi,
} from '../src/utils/utils';

function expectAssetValues(expected: string[], mangoGroup: MangoGroup, mangoCache: MangoCache, mangoAccount: MangoAccount) {
  for (let i = 0; i < mangoGroup.numOracles; i++) {
    const price = mangoCache.getPrice(i)
    const perpAssetVal = mangoAccount.perpAccounts[i].getAssetVal(
      mangoGroup.perpMarkets[i],
      price,
      mangoCache.perpMarketCache[i].shortFunding,
      mangoCache.perpMarketCache[i].longFunding,
    )
    const perpsUiAssetVal = nativeI80F48ToUi(
      perpAssetVal,
      mangoGroup.tokens[QUOTE_INDEX].decimals,
    );
    expect(perpsUiAssetVal.toString(), `Asset value at index ${i}`).to.equal(expected[i])
  }
}

function expectLiabilitytValues(expected: string[], mangoGroup: MangoGroup, mangoCache: MangoCache, mangoAccount: MangoAccount) {
  for (let i = 0; i < mangoGroup.numOracles; i++) {
    const price = mangoCache.getPrice(i)
    const perpLiabilityVal = mangoAccount.perpAccounts[i].getLiabsVal(
      mangoGroup.perpMarkets[i],
      price,
      mangoCache.perpMarketCache[i].shortFunding,
      mangoCache.perpMarketCache[i].longFunding,
    )
    const perpsUiLiabilityVal = nativeI80F48ToUi(
      perpLiabilityVal,
      mangoGroup.tokens[QUOTE_INDEX].decimals,
    );
    expect(perpsUiLiabilityVal.toString(), `Liability value at index ${i}`).to.equal(expected[i])
  }
}

function expectUnsettledFundingValues(expected: string[], mangoGroup: MangoGroup, mangoCache: MangoCache, mangoAccount: MangoAccount) {
  for (let i = 0; i < mangoGroup.numOracles; i++) {
    const perpAssetVal = mangoAccount.perpAccounts[i].getUnsettledFunding(mangoCache.perpMarketCache[i])
    const perpsUiAssetVal = nativeI80F48ToUi(
      perpAssetVal,
      mangoGroup.tokens[QUOTE_INDEX].decimals,
    );
    expect(perpsUiAssetVal.toString(), `Unsettled funding value at index ${i}`).to.equal(expected[i])
  }
}

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
      const expectedPerpAssetValues = [
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectAssetValues(expectedPerpAssetValues, mangoGroup, mangoCache, mangoAccount)
      const expectedPerpLiabilityValues = [
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectLiabilitytValues(expectedPerpLiabilityValues, mangoGroup, mangoCache, mangoAccount)
      const expectedUnsettledFundingValues = [
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectUnsettledFundingValues(expectedUnsettledFundingValues, mangoGroup, mangoCache, mangoAccount)
      expect(
        mangoAccount.calcTotalPerpUnsettledPnl(mangoGroup, mangoCache).toString()
      ).to.equal("0");
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
      const expectedPerpAssetValues = [
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectAssetValues(expectedPerpAssetValues, mangoGroup, mangoCache, mangoAccount)
      const expectedPerpLiabilityValues = [
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectLiabilitytValues(expectedPerpLiabilityValues, mangoGroup, mangoCache, mangoAccount)
      const expectedUnsettledFundingValues = [
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectUnsettledFundingValues(expectedUnsettledFundingValues, mangoGroup, mangoCache, mangoAccount)
      expect(
        mangoAccount.calcTotalPerpUnsettledPnl(mangoGroup, mangoCache).toString()
      ).to.equal("0");
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
      const expectedPerpAssetValues = [
        "0",
        "0",
        "0",
        "2444.20361099997762721614",
        "0",
        "0",
        "0",
        "0",
      ]
      expectAssetValues(expectedPerpAssetValues, mangoGroup, mangoCache, mangoAccount)
      const expectedPerpLiabilityValues = [
        "0",
        "0.11103041194074236842",
        "0",
        "2231.02793460350823551153",
        "0",
        "0",
        "0",
        "0",
      ]
      expectLiabilitytValues(expectedPerpLiabilityValues, mangoGroup, mangoCache, mangoAccount)
      const expectedUnsettledFundingValues = [
        "0",
        "0",
        "0",
        "0.15100476036453613915",
        "0",
        "0",
        "0",
        "0",
      ]
      expectUnsettledFundingValues(expectedUnsettledFundingValues, mangoGroup, mangoCache, mangoAccount)
      expect(
        mangoAccount.calcTotalPerpUnsettledPnl(mangoGroup, mangoCache).toString()
      ).to.equal("213064645.98452864467761003198");
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
      const expectedPerpAssetValues = [
        "0",
        "0",
        "0",
        "42015.62498699979641969549",
        "0",
        "0",
        "0",
        "0",
      ]
      expectAssetValues(expectedPerpAssetValues, mangoGroup, mangoCache, mangoAccount)
      const expectedPerpLiabilityValues = [
        "0",
        "0.46957178494401929925",
        "0",
        "41767.25007673670625862883",
        "0",
        "0",
        "0",
        "0",
      ]
      expectLiabilitytValues(expectedPerpLiabilityValues, mangoGroup, mangoCache, mangoAccount)
      const expectedUnsettledFundingValues = [
        "0",
        "0",
        "0",
        "2.24818743769938222954",
        "0",
        "0",
        "0",
        "0",
      ]
      expectUnsettledFundingValues(expectedUnsettledFundingValues, mangoGroup, mangoCache, mangoAccount)
      expect(
        mangoAccount.calcTotalPerpUnsettledPnl(mangoGroup, mangoCache).toString()
      ).to.equal("247905338.47814613599853572623");
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
      const expectedPerpAssetValues = [
        "0",
        "6695937.04678345438030007131",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectAssetValues(expectedPerpAssetValues, mangoGroup, mangoCache, mangoAccount)
      const expectedPerpLiabilityValues = [
        "0",
        "6670154.10595839999994893788",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectLiabilitytValues(expectedPerpLiabilityValues, mangoGroup, mangoCache, mangoAccount)
      const expectedUnsettledFundingValues = [
        "0",
        "10.21039760429788145757",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectUnsettledFundingValues(expectedUnsettledFundingValues, mangoGroup, mangoCache, mangoAccount)
      expect(
        mangoAccount.calcTotalPerpUnsettledPnl(mangoGroup, mangoCache).toString()
      ).to.equal("25782940825.05438035059867374343");
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
      const expectedPerpAssetValues = [
        "0",
        "7264559.17356035336612407605",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectAssetValues(expectedPerpAssetValues, mangoGroup, mangoCache, mangoAccount)
      const expectedPerpLiabilityValues = [
        "0",
        "8284356.46961939999987123429",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectLiabilitytValues(expectedPerpLiabilityValues, mangoGroup, mangoCache, mangoAccount)
      const expectedUnsettledFundingValues = [
        "0",
        "664519.22525166063196522259",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectUnsettledFundingValues(expectedUnsettledFundingValues, mangoGroup, mangoCache, mangoAccount)
      expect(
        mangoAccount.calcTotalPerpUnsettledPnl(mangoGroup, mangoCache).toString()
      ).to.equal("-1019797296059.04663374607682513329");
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
      const expectedPerpAssetValues = [
        "1273.61269133691491362015",
        "10916456.07050622382794102805",
        "863331.92364778832709859557",
        "174610.40243434425205748539",
        "0",
        "0",
        "0",
        "14633.04150478681525626712",
        "16805.69099999999941985607",
        "137915.48069440506524330203",
        "0",
        "0",
        "0",
      ]
      expectAssetValues(expectedPerpAssetValues, mangoGroup, mangoCache, mangoAccount)
      const expectedPerpLiabilityValues = [
        "4840.92399999998631798803",
        "0",
        "767288.86646559999954675391",
        "167720.92749999994865106601",
        "0",
        "0",
        "0",
        "1026.61699999999799359784",
        "16788.37122433173017910235",
        "110453.27723675812123360629",
        "0",
        "0",
        "0",
      ]
      expectLiabilitytValues(expectedPerpLiabilityValues, mangoGroup, mangoCache, mangoAccount)
      const expectedUnsettledFundingValues = [
        "3103.41003963214380689806",
        "-10159.21051005666226529911",
        "24694.52420961676692812148",
        "0.32868646996947603611",
        "0",
        "0",
        "0",
        "66.45867935453308206206",
        "44.4412243317308117696",
        "-15298.57214184517950528175",
        "0",
        "0",
        "0",
      ]
      expectUnsettledFundingValues(expectedUnsettledFundingValues, mangoGroup, mangoCache, mangoAccount)
      expect(
        mangoAccount.calcTotalPerpUnsettledPnl(mangoGroup, mangoCache).toString()
      ).to.equal("11056907239052.19541801780440337666");
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
      const expectedPerpAssetValues = [
        "509.04481457486919993016",
        "10831730.01433129633670660041",
        "863100.47162162728756484853",
        "54819.20758920613437226166",
        "0",
        "0",
        "0",
        "14632.99379123635924315749",
        "15945.13199999999883971213",
        "137931.25478163725913560711",
        "0",
        "0",
        "0",
      ]
      expectAssetValues(expectedPerpAssetValues, mangoGroup, mangoCache, mangoAccount)
      const expectedPerpLiabilityValues = [
        "4587.29287500003797717341",
        "0",
        "667788.07238879999951208788",
        "26741.02804999988158840551",
        "0",
        "0",
        "0",
        "901.57549999999859124955",
        "16788.69364044275738834244",
        "90977.10634675426490503014",
        "0",
        "0",
        "0",
      ]
      expectLiabilitytValues(expectedPerpLiabilityValues, mangoGroup, mangoCache, mangoAccount)
      const expectedUnsettledFundingValues = [
        "3867.97791639418952058804",
        "-46.41303398421391435136",
        "24925.97623577780646186852",
        "0.00101160821814261226",
        "0",
        "0",
        "0",
        "66.50639290498909161897",
        "44.76364044275802100969",
        "-15314.34622907737339758683",
        "0",
        "0",
        "0",
      ]
      expectUnsettledFundingValues(expectedUnsettledFundingValues, mangoGroup, mangoCache, mangoAccount)
      expect(
        mangoAccount.calcTotalPerpUnsettledPnl(mangoGroup, mangoCache).toString()
      ).to.equal("11110884350128.58130511011427898893");
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
      const expectedPerpAssetValues = [
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectAssetValues(expectedPerpAssetValues, mangoGroup, mangoCache, mangoAccount)
      const expectedPerpLiabilityValues = [
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectLiabilitytValues(expectedPerpLiabilityValues, mangoGroup, mangoCache, mangoAccount)
      const expectedUnsettledFundingValues = [
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectUnsettledFundingValues(expectedUnsettledFundingValues, mangoGroup, mangoCache, mangoAccount)
      expect(
        mangoAccount.calcTotalPerpUnsettledPnl(mangoGroup, mangoCache).toString()
      ).to.equal("0");
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
      const expectedPerpAssetValues = [
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectAssetValues(expectedPerpAssetValues, mangoGroup, mangoCache, mangoAccount)
      const expectedPerpLiabilityValues = [
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectLiabilitytValues(expectedPerpLiabilityValues, mangoGroup, mangoCache, mangoAccount)
      const expectedUnsettledFundingValues = [
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]
      expectUnsettledFundingValues(expectedUnsettledFundingValues, mangoGroup, mangoCache, mangoAccount)
      expect(
        mangoAccount.calcTotalPerpUnsettledPnl(mangoGroup, mangoCache).toString()
      ).to.equal("0");
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
      const expectedPerpAssetValues = [
        "500.04990000000077543518",
        "2.52363260494343677465",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "638.89864039999952893822",
        "3.91741263385862836799",
      ]
      expectAssetValues(expectedPerpAssetValues, mangoGroup, mangoCache, mangoAccount)
      const expectedPerpLiabilityValues = [
        "495.17376736598619757501",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "2.17483424573713435279",
        "561.66384985128874873794",
        "0",
      ]
      expectLiabilitytValues(expectedPerpLiabilityValues, mangoGroup, mangoCache, mangoAccount)
      const expectedUnsettledFundingValues = [
        "-0.00075984027774822493",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "-0.0643417436628475059",
        "0",
      ]
      expectUnsettledFundingValues(expectedUnsettledFundingValues, mangoGroup, mangoCache, mangoAccount)
      expect(
        mangoAccount.calcTotalPerpUnsettledPnl(mangoGroup, mangoCache).toString()
      ).to.equal("86377134.1757902877071373382");
      expect(
        mangoAccount.computeValue(mangoGroup, mangoCache).toString()
      ).to.equal("926.98053240315212875089");
      expect(
        mangoAccount.getLeverage(mangoGroup, mangoCache).toString()
      ).to.equal("3.91944283828893702548");
      expect(mangoAccount.isLiquidatable(mangoGroup, mangoCache)).to.be.false
    });
  });

  describe('account10', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/account10"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      mangoAccount.spotOpenOrdersAccounts[1] = loadTestOpenOrders(`${prefix}/openorders0.json`)
      mangoAccount.spotOpenOrdersAccounts[1] = loadTestOpenOrders(`${prefix}/openorders1.json`)
      mangoAccount.spotOpenOrdersAccounts[1] = loadTestOpenOrders(`${prefix}/openorders3.json`)
      mangoAccount.spotOpenOrdersAccounts[1] = loadTestOpenOrders(`${prefix}/openorders5.json`)
      mangoAccount.spotOpenOrdersAccounts[1] = loadTestOpenOrders(`${prefix}/openorders6.json`)
      mangoAccount.spotOpenOrdersAccounts[5] = loadTestOpenOrders(`${prefix}/openorders8.json`)
      mangoAccount.spotOpenOrdersAccounts[10] = loadTestOpenOrders(`${prefix}/openorders10.json`)
      mangoAccount.spotOpenOrdersAccounts[11] = loadTestOpenOrders(`${prefix}/openorders11.json`)
      mangoAccount.spotOpenOrdersAccounts[12] = loadTestOpenOrders(`${prefix}/openorders12.json`)
      mangoAccount.spotOpenOrdersAccounts[13] = loadTestOpenOrders(`${prefix}/openorders13.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)

      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("835447528.00765534142685098118");
      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("1104560586.65938873999447622509");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("72.79490618339146124072");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("103.85025532240703682874");
      const expectedPerpAssetValues = [
        "161.82500000000032969183",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "794.21118547499958140179",
        "0",
      ]
      expectAssetValues(expectedPerpAssetValues, mangoGroup, mangoCache, mangoAccount)
      const expectedPerpLiabilityValues = [
        "173.90619573205822590012",
        "24.39281775757780579283",
        "0",
        "15.68883989096832820564",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "3.31116257349290776801",
        "921.47040719505843142656",
        "320.97619305086903551683",
      ]
      expectLiabilitytValues(expectedPerpLiabilityValues, mangoGroup, mangoCache, mangoAccount)
      const expectedUnsettledFundingValues = [
        "-2.99380426794160570125",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "-9.27420470494136139905",
        "0",
      ]
      expectUnsettledFundingValues(expectedUnsettledFundingValues, mangoGroup, mangoCache, mangoAccount)
      expect(
        mangoAccount.calcTotalPerpUnsettledPnl(mangoGroup, mangoCache).toString()
      ).to.equal("-503709430.72502483557941133085");
      expect(
        mangoAccount.computeValue(mangoGroup, mangoCache).toString()
      ).to.equal("1373.66979736174514670211");
      expect(
        mangoAccount.getLeverage(mangoGroup, mangoCache).toString()
      ).to.equal("2.22052732148808473767");
      expect(mangoAccount.isLiquidatable(mangoGroup, mangoCache)).to.be.false
    });
  });

  describe('account11', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/account11"
      const mangoGroup: MangoGroup = loadTestMangoGroup(`${prefix}/group.json`)
      const mangoAccount: MangoAccount = loadTestMangoAccount(`${prefix}/account.json`)
      mangoAccount.spotOpenOrdersAccounts[1] = loadTestOpenOrders(`${prefix}/openorders0.json`)
      mangoAccount.spotOpenOrdersAccounts[1] = loadTestOpenOrders(`${prefix}/openorders1.json`)
      mangoAccount.spotOpenOrdersAccounts[1] = loadTestOpenOrders(`${prefix}/openorders2.json`)
      mangoAccount.spotOpenOrdersAccounts[1] = loadTestOpenOrders(`${prefix}/openorders3.json`)
      mangoAccount.spotOpenOrdersAccounts[5] = loadTestOpenOrders(`${prefix}/openorders8.json`)
      const mangoCache: MangoCache = loadTestMangoCache(`${prefix}/cache.json`)

      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("39961574027436.07695988276125120819");
      expect(
        mangoAccount.getHealth(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("46927302394129.7680569215865240551");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Init').toString()
      ).to.equal("58.58402019010213734873");
      expect(
        mangoAccount.getHealthRatio(mangoGroup, mangoCache, 'Maint').toString()
      ).to.equal("72.54246867510758534081");
      const expectedPerpAssetValues = [
        "0",
        "9619318.95868651314757258319",
        "0",
        "42399491.90996890013586551049",
        "0",
        "0",
        "0",
        "981.3631897122233667119",
        "16996.97999999999900921921",
        "182875.91208141305408219068",
        "0",
        "0",
        "5829.91485809974665599498",
      ]
      expectAssetValues(expectedPerpAssetValues, mangoGroup, mangoCache, mangoAccount)
      const expectedPerpLiabilityValues = [
        "8189.09699235532022854045",
        "4484552.3672399999998035014",
        "5114738.04900667368854172423",
        "55898444.4534330697132240573",
        "0",
        "0",
        "0",
        "601.2239999999987389856",
        "16374.41774432560687912996",
        "71748.83339503044979323931",
        "0",
        "0",
        "1418.11669999969289790442",
      ]
      expectLiabilitytValues(expectedPerpLiabilityValues, mangoGroup, mangoCache, mangoAccount)
      const expectedUnsettledFundingValues = [
        "4.61795774701042915922",
        "0",
        "-7111.06002774763295093408",
        "42808.6586575752289647312",
        "0",
        "0",
        "0",
        "52.01280125205020254953",
        "-36.9736725355944102489",
        "-1500.27980607061239481936",
        "0",
        "0",
        "303.73655877831032512404",
      ]
      expectUnsettledFundingValues(expectedUnsettledFundingValues, mangoGroup, mangoCache, mangoAccount)
      expect(
        mangoAccount.calcTotalPerpUnsettledPnl(mangoGroup, mangoCache).toString()
      ).to.equal("-13370571519726.81616354968236848322");
      expect(
        mangoAccount.computeValue(mangoGroup, mangoCache).toString()
      ).to.equal("53893030.74839379973506936494");
      expect(
        mangoAccount.getLeverage(mangoGroup, mangoCache).toString()
      ).to.equal("1.27578614104216114811");
      expect(mangoAccount.isLiquidatable(mangoGroup, mangoCache)).to.be.false
    });
  });
});