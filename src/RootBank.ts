import { Connection, PublicKey } from '@solana/web3.js';
import { I80F48, ZERO_I80F48 } from './utils/fixednum';
import { NodeBank, NodeBankLayout } from './layout';
import { getMultipleAccounts, nativeI80F48ToUi, zeroKey } from './utils/utils';
import BN from 'bn.js';
import MangoGroup from './MangoGroup';

export default class RootBank {
  publicKey: PublicKey;
  optimalUtil!: I80F48;
  optimalRate!: I80F48;
  maxRate!: I80F48;

  numNodeBanks!: number;
  nodeBanks!: PublicKey[];
  depositIndex!: I80F48;
  borrowIndex!: I80F48;
  lastUpdated!: BN;

  nodeBankAccounts: NodeBank[];
  //mintKey: PublicKey;

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    Object.assign(this, decoded);
    this.nodeBankAccounts = [];
    //this.mintKey = tokenMint;
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

    return this.borrowIndex.mul(totalBorrow);
  }

  getUiTotalDeposit(mangoGroup: MangoGroup): I80F48 {
    const tokenIndex = mangoGroup.getRootBankIndex(this.publicKey);

    return nativeI80F48ToUi(
      this.getNativeTotalDeposit(),
      mangoGroup.tokens[tokenIndex].decimals,
    );
  }

  getUiTotalBorrow(mangoGroup: MangoGroup): I80F48 {
    const tokenIndex = mangoGroup.getRootBankIndex(this.publicKey);

    return nativeI80F48ToUi(
      this.getNativeTotalBorrow(),
      mangoGroup.tokens[tokenIndex].decimals,
    );
  }

  getBorrowRate(mangoGroup: MangoGroup): I80F48 {
    const totalBorrows = this.getUiTotalBorrow(mangoGroup);
    const totalDeposits = this.getUiTotalDeposit(mangoGroup);

    if (totalDeposits.eq(ZERO_I80F48) && totalBorrows.eq(ZERO_I80F48)) {
      return ZERO_I80F48;
    }
    if (totalDeposits.lte(totalBorrows)) {
      return this.maxRate;
    }

    const utilization = totalBorrows.div(totalDeposits);
    if (utilization.gt(this.optimalUtil)) {
      const extraUtil = utilization.sub(this.optimalUtil);
      const slope = this.maxRate
        .sub(this.optimalRate)
        .div(I80F48.fromNumber(1).sub(this.optimalUtil));
      return this.optimalRate.add(slope.mul(extraUtil));
    } else {
      const slope = this.optimalRate.div(this.optimalUtil);
      return slope.mul(utilization);
    }
  }

  getDepositRate(mangoGroup: MangoGroup): I80F48 {
    const borrowRate = this.getBorrowRate(mangoGroup);
    const totalBorrows = this.getUiTotalBorrow(mangoGroup);
    const totalDeposits = this.getUiTotalDeposit(mangoGroup);

    if (totalDeposits.eq(ZERO_I80F48) && totalBorrows.eq(ZERO_I80F48)) {
      return ZERO_I80F48;
    } else if (totalDeposits.eq(ZERO_I80F48)) {
      return this.maxRate;
    }

    const utilization = totalBorrows.div(totalDeposits);
    return utilization.mul(borrowRate);
  }
}
