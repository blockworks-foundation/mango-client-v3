import { OpenOrders } from '@project-serum/serum';
import { Connection, PublicKey } from '@solana/web3.js';
import { I80F48 } from './fixednum';
import { MAX_PAIRS, MetaData, PerpAccount, RootBank } from './layout';
import { promiseUndef, zeroKey } from './utils';

export default class MerpsAccount {
  publicKey: PublicKey;
  metaData!: MetaData;
  merpsGroup!: PublicKey;
  owner!: PublicKey;

  inBasket!: boolean[];
  deposits!: I80F48[];
  borrows!: I80F48[];

  spotOpenOrders!: PublicKey[];
  spotOpenOrdersAccounts: (OpenOrders | undefined)[];

  perpAccounts!: PerpAccount[];

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    this.spotOpenOrdersAccounts = new Array(MAX_PAIRS).fill(undefined);

    Object.assign(this, decoded);
  }

  getNativeDeposit(rootBank: RootBank, tokenIndex: number): I80F48 {
    // TODO maybe load rootBank here instead of passing in?
    return rootBank.depositIndex.mul(this.deposits[tokenIndex]);
  }
  getNativeBorrow(rootBank: RootBank, tokenIndex: number): I80F48 {
    return rootBank.borrowIndex.mul(this.borrows[tokenIndex]);
  }
  getUiDeposit(): number {
    throw new Error('not implemented');
  }
  getUiBorrow(): number {
    throw new Error('not implemented');
  }

  async loadOpenOrders(
    connection: Connection,
    serumDexPk: PublicKey,
  ): Promise<(OpenOrders | undefined)[]> {
    const promises: Promise<OpenOrders | undefined>[] = [];

    for (let i = 0; i < this.spotOpenOrders.length; i++) {
      if (this.spotOpenOrders[i].equals(zeroKey)) {
        promises.push(promiseUndef());
      } else {
        promises.push(
          OpenOrders.load(connection, this.spotOpenOrders[i], serumDexPk),
        );
      }
    }

    this.spotOpenOrdersAccounts = await Promise.all(promises);
    return this.spotOpenOrdersAccounts;
  }
}
