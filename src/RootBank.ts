import { Connection, PublicKey } from '@solana/web3.js';
import { I80F48, ZERO_I80F48 } from './fixednum';
import {
  MAX_RATE,
  NodeBank,
  NodeBankLayout,
  OPTIMAL_RATE,
  OPTIMAL_UTIL,
} from './layout';
import { getMultipleAccounts, zeroKey } from './utils';
import BN from 'bn.js';
import MerpsGroup from './MerpsGroup';

export class RootBank {
  publicKey: PublicKey;

  numNodeBanks!: number;
  nodeBanks!: PublicKey[];
  depositIndex!: I80F48;
  borrowIndex!: I80F48;
  lastUpdated!: BN;

  nodeBankAccounts: NodeBank[];

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    Object.assign(this, decoded);
    this.nodeBankAccounts = [];
  }

  async loadNodeBanks(connection: Connection): Promise<NodeBank[]> {
    const filteredNodeBanks = this.nodeBanks.filter(
      (nb) => !nb.equals(zeroKey),
    );
    const accounts = await getMultipleAccounts(connection, filteredNodeBanks);

    const nodeBankAccounts = accounts.map((acc) => {
      const decoded = NodeBankLayout.decode(acc.accountInfo.data);
      return new NodeBank(acc.publicKey, decoded);
    });
    this.nodeBankAccounts = nodeBankAccounts;
    return nodeBankAccounts;
  }

  getNativeTotalDeposit(): I80F48 {
    if (!this.nodeBankAccounts.length)
      throw new Error('Node bank accounts empty');

    let totalDeposits: I80F48 = ZERO_I80F48;

    for (let i = 0; i < this.nodeBankAccounts.length; i++) {
      totalDeposits = totalDeposits.add(this.nodeBankAccounts[i].deposits);
    }

    return this.depositIndex.mul(totalDeposits);
  }

  getNativeTotalBorrow(): I80F48 {
    if (!this.nodeBankAccounts.length)
      throw new Error('Node bank accounts empty');

    let totalBorrow: I80F48 = ZERO_I80F48;

    for (let i = 0; i < this.nodeBankAccounts.length; i++) {
      totalBorrow = totalBorrow.add(this.nodeBankAccounts[i].borrows);
    }

    return this.depositIndex.mul(totalBorrow);
  }

  getUiTotalDeposit(merpsGroup: MerpsGroup): I80F48 {
    const tokenIndex = merpsGroup.getRootBankIndex(this.publicKey);

    return this.getNativeTotalDeposit().div(
      I80F48.fromNumber(merpsGroup.tokens[tokenIndex].decimals),
    );
  }

  getUiTotalBorrow(merpsGroup: MerpsGroup): I80F48 {
    const tokenIndex = merpsGroup.getRootBankIndex(this.publicKey);

    return this.getNativeTotalBorrow().div(
      I80F48.fromNumber(merpsGroup.tokens[tokenIndex].decimals),
    );
  }

  getBorrowRate(merpsGroup: MerpsGroup): I80F48 {
    const totalBorrows = this.getUiTotalBorrow(merpsGroup);
    const totalDeposits = this.getUiTotalDeposit(merpsGroup);

    if (totalDeposits === ZERO_I80F48 && totalBorrows === ZERO_I80F48) {
      return ZERO_I80F48;
    }
    if (totalDeposits <= totalBorrows) {
      return MAX_RATE;
    }

    const utilization = totalBorrows.div(totalDeposits);
    if (utilization > OPTIMAL_UTIL) {
      const extraUtil = utilization.sub(OPTIMAL_UTIL);
      const slope = MAX_RATE.sub(OPTIMAL_RATE).div(
        I80F48.fromNumber(1).sub(OPTIMAL_UTIL),
      );
      return OPTIMAL_RATE.add(slope.mul(extraUtil));
    } else {
      const slope = OPTIMAL_RATE.div(OPTIMAL_UTIL);
      return slope.mul(utilization);
    }
  }

  getDepositRate(merpsGroup: MerpsGroup): I80F48 {
    const borrowRate = this.getBorrowRate(merpsGroup);
    const totalBorrows = this.getUiTotalBorrow(merpsGroup);
    const totalDeposits = this.getUiTotalDeposit(merpsGroup);

    if (totalDeposits === ZERO_I80F48 && totalBorrows === ZERO_I80F48) {
      return ZERO_I80F48;
    } else if (totalDeposits === ZERO_I80F48) {
      return MAX_RATE;
    }

    const utilization = totalBorrows.div(totalDeposits);
    return utilization.mul(borrowRate);
  }
}
