import {
  Account,
  Connection,
  SimulatedTransactionResponse,
  Transaction,
  TransactionConfirmationStatus,
  TransactionSignature,
} from '@solana/web3.js';
import { awaitTransactionSignatureConfirmation, simulateTransaction, sleep } from './utils';



export async function sendTransactions(
  connection: Connection,
  transactions: Transaction[],
  payer: Account,
  additionalSigners: Account[],
  timeout = 30000,
  confirmLevel: TransactionConfirmationStatus = 'confirmed'
): Promise<TransactionSignature[]> {
  // what to do about the case where0000000000000000
  // so what to do tin this case where this is not a proble
  //
  // Does it still shake? not really I think
  // Ok this is definitely more stable. Wow what a big difference this makes0

  return await Promise.all(transactions.map((tx) => sendTransaction(connection, tx, payer, additionalSigners, timeout, confirmLevel)))
}
export const getUnixTs = () => {
  return new Date().getTime() / 1000;
}

export async function sendTransaction(
  connection: Connection,
  transaction: Transaction,
  payer: Account,
  additionalSigners: Account[],
  timeout = 30000,
  confirmLevel: TransactionConfirmationStatus = 'confirmed'
): Promise<TransactionSignature> {

  transaction.recentBlockhash = (await connection.getRecentBlockhash('singleGossip')).blockhash
  transaction.setSigners(payer.publicKey, ...additionalSigners.map( a => a.publicKey ))

  const signers = [payer].concat(additionalSigners)
  transaction.sign(...signers)
  const rawTransaction = transaction.serialize()
  const startTime = getUnixTs();

  const txid: TransactionSignature = await connection.sendRawTransaction(rawTransaction, { skipPreflight: true, },);

  console.log('Started awaiting confirmation for', txid);
  let done = false;
  (async () => {
    while (!done && (getUnixTs() - startTime) < timeout / 1000) {
      connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true
      });
      await sleep(300);
    }
  })();

  try {
    await awaitTransactionSignatureConfirmation(txid, timeout, connection, confirmLevel);
  } catch (err) {
    if (err.timeout) {
      throw new Error('Timed out awaiting confirmation on transaction');
    }
    let simulateResult: SimulatedTransactionResponse | null = null;
    try {
      simulateResult = (
        await simulateTransaction(connection, transaction, 'singleGossip')
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