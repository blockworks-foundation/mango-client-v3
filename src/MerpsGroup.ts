import { Market } from '@project-serum/serum';
import { AccountInfo, Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import {
  MetaData,
  RootBank,
  RootBankLayout,
  TokenInfo,
  SpotMarketInfo,
  PerpMarketInfo,
  NodeBank,
  PerpMarket,
  RootBankCache,
  MerpsCache,
  MerpsCacheLayout,
} from './layout';
import { promiseUndef, zeroKey } from './utils';

export const MAX_TOKENS = 32;
export const MAX_PAIRS = MAX_TOKENS - 1;
export const MAX_NODE_BANKS = 8;
export const QUOTE_INDEX = MAX_TOKENS - 1;

export default class MerpsGroup {
  publicKey: PublicKey;
  metaData!: MetaData;
  numOracles!: number;
  tokens!: TokenInfo[];
  spotMarkets!: SpotMarketInfo[];
  perpMarkets!: PerpMarketInfo[];
  oracles!: PublicKey[];
  signerNonce!: BN;
  signerKey!: PublicKey;
  admin!: PublicKey;
  dexProgramId!: PublicKey;
  merpsCache!: PublicKey;
  validInterval!: number[];

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    Object.assign(this, decoded);
  }

  getOracleIndex(oracle: PublicKey): number {
    for (let i = 0; i < this.numOracles; i++) {
      if (this.oracles[i].equals(oracle)) {
        return i;
      }
    }
    throw new Error('This Oracle does not belong to this MerpsGroup');
  }

  getSpotMarketIndex(spotMarket: Market): number {
    for (let i = 0; i < this.numOracles; i++) {
      if (this.spotMarkets[i].spotMarket.equals(spotMarket.publicKey)) {
        return i;
      }
    }
    throw new Error('This Market does not belong to this MerpsGroup');
  }

  getPerpMarketIndex(perpMarket: PerpMarket): number {
    for (let i = 0; i < this.numOracles; i++) {
      if (this.perpMarkets[i].perpMarket.equals(perpMarket.publicKey)) {
        return i;
      }
    }
    throw new Error('This PerpMarket does not belong to this MerpsGroup');
  }

  getTokenIndex(token: PublicKey): number {
    for (let i = 0; i < this.tokens.length; i++) {
      if (this.tokens[i].mint.equals(token)) {
        return i;
      }
    }
    throw new Error('This token does not belong in this MerpsGroup');
  }

  getRootBankIndex(rootBank: PublicKey): number {
    for (let i = 0; i < this.tokens.length; i++) {
      if (this.tokens[i].rootBank.equals(rootBank)) {
        return i;
      }
    }
    throw new Error('This root bank does not belong in this MerpsGroup');
  }

  // getBorrowRate(tokenIndex: number): number {

  //   const totalBorrows = this.getUiTotalBorrow(tokenIndex)
  //   const totalDeposits = this.getUiTotalDeposit(tokenIndex)

  //   if (totalDeposits === 0 && totalBorrows === 0) {
  //     return 0
  //   }
  //   if (totalDeposits <= totalBorrows) {
  //     return MAX_RATE
  //   }

  //   const utilization = totalBorrows / totalDeposits
  //   if (utilization > OPTIMAL_UTIL) {
  //     const extraUtil = utilization - OPTIMAL_UTIL
  //     const slope = (MAX_RATE - OPTIMAL_RATE) / (1 - OPTIMAL_UTIL)
  //     return OPTIMAL_RATE + slope * extraUtil
  //   } else {
  //     const slope = OPTIMAL_RATE / OPTIMAL_UTIL
  //     return slope * utilization
  //   }
  // }
  // getDepositRate(tokenIndex: number): number {
  //   const borrowRate = this.getBorrowRate(tokenIndex)
  //   const totalBorrows = this.getUiTotalBorrow(tokenIndex)
  //   const totalDeposits = this.getUiTotalDeposit(tokenIndex)
  //   if (totalDeposits === 0 && totalBorrows === 0) {
  //     return 0
  //   } else if (totalDeposits === 0) {
  //     return MAX_RATE
  //   }
  //   const utilization = totalBorrows / totalDeposits
  //   return utilization * borrowRate
  // }

  // getUiTotalDeposit(
  //   rootBank: RootBank | RootBankCache,
  //   tokenIndex: number,
  // ): number {
  //   return nativeToUi(
  //     this.totalDeposits[tokenIndex] * this.indexes[tokenIndex].deposit,
  //     this.tokens[tokenIndex].decimals,
  //   );
  // }
  // getUiTotalBorrow(
  //   rootBank: RootBank | RootBankCache,
  //   tokenIndex: number,
  // ): number {
  //   return nativeToUi(
  //     this.totalBorrows[tokenIndex] * this.indexes[tokenIndex].borrow,
  //     this.tokens[tokenIndex].decimals,
  //   );
  // }

  async loadCache(connection: Connection): Promise<MerpsCache> {
    const account = await connection.getAccountInfo(this.merpsCache);
    if (!account || !account?.data) throw new Error('Unable to load cache');

    const decoded = MerpsCacheLayout.decode(account.data);
    return new MerpsCache(this.merpsCache, decoded);
  }

  async loadRootBanks(
    connection: Connection,
  ): Promise<(RootBank | undefined)[]> {
    const promises: Promise<AccountInfo<Buffer> | undefined | null>[] = [];

    for (let i = 0; i < this.tokens.length; i++) {
      if (this.tokens[i].rootBank.equals(zeroKey)) {
        promises.push(promiseUndef());
      } else {
        promises.push(connection.getAccountInfo(this.tokens[i].rootBank));
      }
    }

    const accounts = await Promise.all(promises);

    return accounts.map((acc, i) => {
      if (acc && acc.data) {
        const decoded = RootBankLayout.decode(acc.data);
        return new RootBank(this.tokens[i].rootBank, decoded);
      }
      return undefined;
    });
  }

  async loadBanksForSpotMarket(
    connection: Connection,
    spotMarketIndex: number,
  ): Promise<{
    baseRootBank: RootBank | undefined;
    baseNodeBank: NodeBank | undefined;
    quoteRootBank: RootBank | undefined;
    quoteNodeBank: NodeBank | undefined;
  }> {
    // TODO only load the root bank for the spot mkt
    const rootBanks = await this.loadRootBanks(connection);

    const baseRootBank = rootBanks[spotMarketIndex];
    const quoteRootBank = rootBanks[QUOTE_INDEX];

    // TODO need to handle multiple node banks
    const nodeBankIndex = 0;
    const baseNodeBankPk = baseRootBank?.nodeBanks[nodeBankIndex];
    const quoteNodeBankPk = quoteRootBank?.nodeBanks[nodeBankIndex];

    const baseNodeBanks = await baseRootBank?.loadNodeBanks(connection);
    const quoteNodeBanks = await quoteRootBank?.loadNodeBanks(connection);

    const baseNodeBank = baseNodeBanks?.find(
      (nodeBank) => nodeBank?.publicKey == baseNodeBankPk,
    );
    const quoteNodeBank = quoteNodeBanks?.find(
      (nodeBank) => nodeBank?.publicKey == quoteNodeBankPk,
    );

    return { baseRootBank, baseNodeBank, quoteRootBank, quoteNodeBank };
  }
}
