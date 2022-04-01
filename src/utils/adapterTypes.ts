import {
  Connection,
  PublicKey,
  SendOptions,
  Transaction,
  Signer,
  TransactionSignature,
} from '@solana/web3.js';
import EventEmitter from 'eventemitter3';

declare class WalletError extends Error {
  error: any;
  constructor(message?: string, error?: any);
}

interface SignerWalletAdapterProps {
  signTransaction(transaction: Transaction): Promise<Transaction>;
  signAllTransactions(transaction: Transaction[]): Promise<Transaction[]>;
}

interface SendTransactionOptions extends SendOptions {
  signers?: Signer[];
}

interface WalletAdapterEvents {
  connect(publicKey: PublicKey): void;
  disconnect(): void;
  error(error: WalletError): void;
  readyStateChange(readyState: WalletReadyState): void;
}

interface MessageSignerWalletAdapterProps {
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

declare type MessageSignerWalletAdapter = WalletAdapter &
  MessageSignerWalletAdapterProps;

interface WalletAdapterProps {
  name: WalletName;
  url: string;
  icon: string;
  readyState: WalletReadyState;
  publicKey: PublicKey | null;
  connecting: boolean;
  connected: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendTransaction(
    transaction: Transaction,
    connection: Connection,
    options?: SendTransactionOptions,
  ): Promise<TransactionSignature>;
}

declare type WalletName = string & {
  __brand__: 'WalletName';
};

export declare type SignerWalletAdapter = WalletAdapter &
  SignerWalletAdapterProps;

declare type WalletAdapter = WalletAdapterProps &
  EventEmitter<WalletAdapterEvents>;

export declare type Adapter =
  | WalletAdapter
  | SignerWalletAdapter
  | MessageSignerWalletAdapter;

interface MessageSignerWalletAdapterProps {
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

declare enum WalletReadyState {
  /**
   * User-installable wallets can typically be detected by scanning for an API
   * that they've injected into the global context. If such an API is present,
   * we consider the wallet to have been installed.
   */
  Installed = 'Installed',
  NotDetected = 'NotDetected',
  /**
   * Loadable wallets are always available to you. Since you can load them at
   * any time, it's meaningless to say that they have been detected.
   */
  Loadable = 'Loadable',
  /**
   * If a wallet is not supported on a given platform (eg. server-rendering, or
   * mobile) then it will stay in the `Unsupported` state.
   */
  Unsupported = 'Unsupported',
}

export const adapterHasSignAllTransactions = (
  adapter: any,
): adapter is SignerWalletAdapter => {
  if ((adapter as SignerWalletAdapter).signAllTransactions) {
    return true;
  }
  return false;
};
