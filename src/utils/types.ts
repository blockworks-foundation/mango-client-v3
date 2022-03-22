import { Keypair } from '@solana/web3.js';
import { Adapter } from './adapterTypes';

/** @internal */
export type Modify<T, R> = Omit<T, keyof R> & R;

export type PerpOrderType =
  | 'limit'
  | 'ioc'
  | 'postOnly'
  | 'market'
  | 'postOnlySlide';

export type BlockhashTimes = { blockhash: string; timestamp: number };

export type Payer = Adapter | Keypair;
