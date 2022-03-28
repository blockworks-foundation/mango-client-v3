import { Keypair } from '@solana/web3.js';
import { Adapter } from './adapterTypes';
import { PublicKey, Transaction } from '@solana/web3.js';

/** @internal */
export type Modify<T, R> = Omit<T, keyof R> & R;

// TODO: remove after migration to Keypair and Adapter types is complete
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

export type Payer = Adapter | Keypair | WalletAdapter;
