import {
  Account,
  Commitment,
  Connection, PublicKey,
  RpcResponseAndContext,
  SimulatedTransactionResponse, SystemProgram,
  Transaction, TransactionConfirmationStatus, TransactionInstruction,
  TransactionSignature,
} from '@solana/web3.js';

export async function awaitTransactionSignatureConfirmation(
  txid: TransactionSignature,
  timeout: number,
  connection: Connection,
  confirmLevel: TransactionConfirmationStatus
) {
  let done = false;

  const confirmLevels: (TransactionConfirmationStatus | null)[] = ['finalized']
  if (confirmLevel === 'confirmed') {
    confirmLevels.push('confirmed')
  } else if (confirmLevel === 'processed') {
    confirmLevels.push('confirmed')
    confirmLevels.push('processed')
  }

  const result = await new Promise((resolve, reject) => {
    (async () => {
      setTimeout(() => {
        if (done) {
          return;
        }
        done = true;
        console.log('Timed out for txid', txid);
        reject({ timeout: true });
      }, timeout);
      try {
        connection.onSignature(
          txid,
          (result) => {
            // console.log('WS confirmed', txid, result);
            done = true;
            if (result.err) {
              reject(result.err);
            } else {
              resolve(result);
            }
          },
          'singleGossip',
        );
        // console.log('Set up WS connection', txid);
      } catch (e) {
        done = true;
        console.log('WS error in setup', txid, e);
      }
      while (!done) {
        // eslint-disable-next-line no-loop-func
        (async () => {
          try {
            const signatureStatuses = await connection.getSignatureStatuses([
              txid,
            ]);
            const result = signatureStatuses && signatureStatuses.value[0];
            if (!done) {
              if (!result) {
                // console.log('REST null result for', txid, result);
              } else if (result.err) {
                console.log('REST error for', txid, result);
                done = true;
                reject(result.err);
              } else if (!(result.confirmations || confirmLevels.includes(result.confirmationStatus))) {
                console.log('REST not confirmed', txid, result);
              } else {
                console.log('REST confirmed', txid, result);
                done = true;
                resolve(result);
              }
            }
          } catch (e) {
            if (!done) {
              console.log('REST connection error: txid', txid, e);
            }
          }
        })();
        await sleep(300);
      }
    })();
  });
  done = true;
  return result;
}

export async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function simulateTransaction(
  connection: Connection,
  transaction: Transaction,
  commitment: Commitment,
): Promise<RpcResponseAndContext<SimulatedTransactionResponse>> {
  // @ts-ignore
  transaction.recentBlockhash = await connection._recentBlockhash(
    // @ts-ignore
    connection._disableBlockhashCaching,
  );

  const signData = transaction.serializeMessage();
  // @ts-ignore
  const wireTransaction = transaction._serialize(signData);
  const encodedTransaction = wireTransaction.toString('base64');
  const config: any = { encoding: 'base64', commitment };
  const args = [encodedTransaction, config];

  // @ts-ignore
  const res = await connection._rpcRequest('simulateTransaction', args);
  if (res.error) {
    throw new Error('failed to simulate transaction: ' + res.error.message);
  }
  return res.result;
}

export async function createAccountInstruction(
  connection: Connection,
  payer: PublicKey,
  space: number,
  owner: PublicKey,
  lamports?: number
): Promise<{ account: Account, instruction: TransactionInstruction }> {
  const account = new Account();
  const instruction = SystemProgram.createAccount({
    fromPubkey: payer,
    newAccountPubkey: account.publicKey,
    lamports: lamports ? lamports : await connection.getMinimumBalanceForRentExemption(space),
    space,
    programId: owner
  })

  return { account, instruction };
}
