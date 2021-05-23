import {
  Account,
  Connection, PublicKey,
  SimulatedTransactionResponse,
  Transaction,
  TransactionConfirmationStatus,
  TransactionSignature,
} from '@solana/web3.js';
import { awaitTransactionSignatureConfirmation, simulateTransaction, sleep } from './utils';


export const getUnixTs = () => {
  return new Date().getTime() / 1000;
}

export class MerpsClient {
  connection: Connection;
  programId: PublicKey

  constructor(connection: Connection, programId: PublicKey) {
    this.connection = connection
    this.programId = programId
  }

  async sendTransactions(
    transactions: Transaction[],
    payer: Account,
    additionalSigners: Account[],
    timeout = 30000,
    confirmLevel: TransactionConfirmationStatus = 'confirmed'
  ): Promise<TransactionSignature[]> {
    return await Promise.all(transactions.map((tx) => this.sendTransaction(tx, payer, additionalSigners, timeout, confirmLevel)))
  }

  async sendTransaction(
    transaction: Transaction,
    payer: Account,
    additionalSigners: Account[],
    timeout = 30000,
    confirmLevel: TransactionConfirmationStatus = 'confirmed'
  ): Promise<TransactionSignature> {

    transaction.recentBlockhash = (await this.connection.getRecentBlockhash('singleGossip')).blockhash
    transaction.setSigners(payer.publicKey, ...additionalSigners.map( a => a.publicKey ))

    const signers = [payer].concat(additionalSigners)
    transaction.sign(...signers)
    const rawTransaction = transaction.serialize()
    const startTime = getUnixTs();

    const txid: TransactionSignature = await this.connection.sendRawTransaction(rawTransaction, { skipPreflight: true, },);

    console.log('Started awaiting confirmation for', txid);
    let done = false;
    (async () => {
      while (!done && (getUnixTs() - startTime) < timeout / 1000) {
        this.connection.sendRawTransaction(rawTransaction, {
          skipPreflight: true
        });
        await sleep(300);
      }
    })();

    try {
      await awaitTransactionSignatureConfirmation(txid, timeout, this.connection, confirmLevel);
    } catch (err) {
      if (err.timeout) {
        throw new Error('Timed out awaiting confirmation on transaction');
      }
      let simulateResult: SimulatedTransactionResponse | null = null;
      try {
        simulateResult = (
          await simulateTransaction(this.connection, transaction, 'singleGossip')
        ).value;
      } catch (e) {

      }
      if (simulateResult && simulateResult.err) {
        if (simulateResult.logs) {
          for (let i = simulateResult.logs.length - 1; i >= 0; --i) {
            const line = simulateResult.logs[i];
            if (line.startsWith('Program log: ')) {
              throw new Error(
                'Transaction failed: ' + line.slice('Program log: '.length),
              );
            }
          }
        }
        throw new Error(JSON.stringify(simulateResult.err));
      }
      throw new Error('Transaction failed');
    } finally {
      done = true;
    }

    console.log('Latency', txid, getUnixTs() - startTime);
    return txid;
  }

  async placePerpOrder(): Promise<TransactionSignature[]> {
    throw new Error("Not Implemented")
  }

  async cancelPerpOrder(): Promise<TransactionSignature[]> {
    throw new Error("Not Implemented")
  }
}