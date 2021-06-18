import BN from 'bn.js';
import {
  Account,
  AccountInfo,
  Commitment,
  Connection,
  PublicKey,
  RpcResponseAndContext,
  SimulatedTransactionResponse,
  SystemProgram,
  Transaction,
  TransactionConfirmationStatus,
  TransactionInstruction,
  TransactionSignature,
} from '@solana/web3.js';
import { TokenInstructions } from '@project-serum/serum';

export const zeroKey = new PublicKey(new Uint8Array(32));

export async function promiseUndef(): Promise<undefined> {
  return undefined;
}

export function uiToNative(amount: number, decimals: number): BN {
  return new BN(Math.round(amount * Math.pow(10, decimals)));
}

export function nativeToUi(amount: number, decimals: number): number {
  return amount / Math.pow(10, decimals);
}

export async function awaitTransactionSignatureConfirmation(
  txid: TransactionSignature,
  timeout: number,
  connection: Connection,
  confirmLevel: TransactionConfirmationStatus,
) {
  let done = false;

  const confirmLevels: (TransactionConfirmationStatus | null | undefined)[] = [
    'finalized',
  ];
  if (confirmLevel === 'confirmed') {
    confirmLevels.push('confirmed');
  } else if (confirmLevel === 'processed') {
    confirmLevels.push('confirmed');
    confirmLevels.push('processed');
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
              } else if (
                !(
                  result.confirmations ||
                  confirmLevels.includes(result.confirmationStatus)
                )
              ) {
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
  lamports?: number,
): Promise<{ account: Account; instruction: TransactionInstruction }> {
  const account = new Account();
  const instruction = SystemProgram.createAccount({
    fromPubkey: payer,
    newAccountPubkey: account.publicKey,
    lamports: lamports
      ? lamports
      : await connection.getMinimumBalanceForRentExemption(space),
    space,
    programId: owner,
  });

  return { account, instruction };
}

export async function createTokenAccountInstructions(
  connection: Connection,
  payer: PublicKey,
  account: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
): Promise<TransactionInstruction[]> {
  return [
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: account,
      lamports: await connection.getMinimumBalanceForRentExemption(165),
      space: 165,
      programId: TokenInstructions.TOKEN_PROGRAM_ID,
    }),
    TokenInstructions.initializeAccount({
      account: account,
      mint,
      owner,
    }),
  ];
}

export async function createSignerKeyAndNonce(
  programId: PublicKey,
  accountKey: PublicKey,
): Promise<{ signerKey: PublicKey; signerNonce: number }> {
  // let res = await PublicKey.findProgramAddress([accountKey.toBuffer()], programId);
  // console.log(res);
  // return {
  //   signerKey: res[0],
  //   signerNonce: res[1]
  // };
  for (let nonce = 0; nonce <= Number.MAX_SAFE_INTEGER; nonce++) {
    try {
      const nonceBuffer = Buffer.alloc(8);
      nonceBuffer.writeUInt32LE(nonce, 0);
      const seeds = [accountKey.toBuffer(), nonceBuffer];
      const key = await PublicKey.createProgramAddress(seeds, programId);
      return {
        signerKey: key,
        signerNonce: nonce,
      };
    } catch (e) {
      continue;
    }
  }

  throw new Error('Could not generate signer key');
}

export async function getFilteredProgramAccounts(
  connection: Connection,
  programId: PublicKey,
  filters,
): Promise<{ publicKey: PublicKey; accountInfo: AccountInfo<Buffer> }[]> {
  // @ts-ignore
  const resp = await connection._rpcRequest('getProgramAccounts', [
    programId.toBase58(),
    {
      commitment: connection.commitment,
      filters,
      encoding: 'base64',
    },
  ]);
  if (resp.error) {
    throw new Error(resp.error.message);
  }
  return resp.result.map(
    ({ pubkey, account: { data, executable, owner, lamports } }) => ({
      publicKey: new PublicKey(pubkey),
      accountInfo: {
        data: Buffer.from(data[0], 'base64'),
        executable,
        owner: new PublicKey(owner),
        lamports,
      },
    }),
  );
}

export async function getMultipleAccounts(
  connection: Connection,
  publicKeys: PublicKey[],
  commitment?: Commitment,
): Promise<{ publicKey: PublicKey; accountInfo: AccountInfo<Buffer> }[]> {
  const publickKeyStrs = publicKeys.map((pk) => pk.toBase58());
  // load connection commitment as a default
  commitment ||= connection.commitment;

  const args = commitment ? [publickKeyStrs, { commitment }] : [publickKeyStrs];
  // @ts-ignore
  const resp = await connection._rpcRequest('getMultipleAccounts', args);
  if (resp.error) {
    throw new Error(resp.error.message);
  }

  return resp.result.value.map(
    ({ data, executable, lamports, owner }, i: number) => ({
      publicKey: publicKeys[i],
      accountInfo: {
        data: Buffer.from(data[0], 'base64'),
        executable,
        owner: new PublicKey(owner),
        lamports,
      },
    }),
  );
}
