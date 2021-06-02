import { OpenOrders } from '@project-serum/serum';
import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { I80F48 } from './fixednum';
import { MetaData, PerpOpenOrders } from './layout';
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
  spotOpenOrdersAccounts!: (OpenOrders | undefined)[];

  basePositions!: BN[];
  quotePositions!: BN[];
  fundingSettled!: I80F48[];
  perpOpenOrders!: PerpOpenOrders[];

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    Object.assign(this, decoded);
  }

  async loadOpenOrders(
    connection: Connection,
    dexProgramId: PublicKey,
  ): Promise<(OpenOrders | undefined)[]> {
    const promises: Promise<OpenOrders | undefined>[] = [];

    for (let i = 0; i < this.spotOpenOrders.length; i++) {
      if (this.spotOpenOrders[i].equals(zeroKey)) {
        promises.push(promiseUndef());
      } else {
        promises.push(
          OpenOrders.load(connection, this.spotOpenOrders[i], dexProgramId),
        );
      }
    }

    this.spotOpenOrdersAccounts = await Promise.all(promises);
    return this.spotOpenOrdersAccounts;
  }
}
