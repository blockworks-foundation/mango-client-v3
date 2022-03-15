import { PublicKey, Transaction } from '@solana/web3.js';

/** @internal */
export type Modify<T, R> = Omit<T, keyof R> & R;
export interface WalletAdapter {
  publicKey: PublicKey;
  connected: boolean;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
  signAllTransactions: (transaction: Transaction[]) => Promise<Transaction[]>;
  connect: () => any;
  disconnect: () => any;
}

export type PerpOrderType =
  | 'limit'
  | 'ioc'
  | 'postOnly'
  | 'market'
  | 'postOnlySlide';

export type BlockhashTimes = { blockhash: string; timestamp: number };
