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
import { OpenOrders, TokenInstructions } from '@project-serum/serum';
import { I80F48, ONE_I80F48 } from './fixednum';
import MangoGroup from './MangoGroup';
import { HealthType } from './MangoAccount';

export const ZERO_BN = new BN(0);
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

export function nativeI80F48ToUi(amount: I80F48, decimals: number): I80F48 {
  return amount.div(I80F48.fromNumber(Math.pow(10, decimals)));
}

/**
 * Return weights corresponding to health type;
 * Weights are all 1 if no healthType provided
 */
export function getWeights(
  mangoGroup: MangoGroup,
  marketIndex: number,
  healthType?: HealthType,
): {
  spotAssetWeight: I80F48;
  spotLiabWeight: I80F48;
  perpAssetWeight: I80F48;
  perpLiabWeight: I80F48;
} {
  if (healthType === 'Maint') {
    return {
      spotAssetWeight: mangoGroup.spotMarkets[marketIndex].maintAssetWeight,
      spotLiabWeight: mangoGroup.spotMarkets[marketIndex].maintLiabWeight,
      perpAssetWeight: mangoGroup.perpMarkets[marketIndex].maintAssetWeight,
      perpLiabWeight: mangoGroup.perpMarkets[marketIndex].maintLiabWeight,
    };
  } else if (healthType === 'Init') {
    return {
      spotAssetWeight: mangoGroup.spotMarkets[marketIndex].initAssetWeight,
      spotLiabWeight: mangoGroup.spotMarkets[marketIndex].initLiabWeight,
      perpAssetWeight: mangoGroup.perpMarkets[marketIndex].initAssetWeight,
      perpLiabWeight: mangoGroup.perpMarkets[marketIndex].initLiabWeight,
    };
  } else {
    return {
      spotAssetWeight: ONE_I80F48,
      spotLiabWeight: ONE_I80F48,
      perpAssetWeight: ONE_I80F48,
      perpLiabWeight: ONE_I80F48,
    };
  }
}

export function splitOpenOrders(openOrders: OpenOrders): {
  quoteFree: I80F48;
  quoteLocked: I80F48;
  baseFree: I80F48;
  baseLocked: I80F48;
} {
  const quoteFree = I80F48.fromU64(
    openOrders.quoteTokenFree.add(openOrders['referrerRebatesAccrued']),
  );
  const quoteLocked = I80F48.fromU64(
    openOrders.quoteTokenTotal.sub(openOrders.quoteTokenFree),
  );
  const baseFree = I80F48.fromU64(openOrders.baseTokenFree);
  const baseLocked = I80F48.fromU64(
    openOrders.baseTokenTotal.sub(openOrders.baseTokenFree),
  );
  return { quoteFree, quoteLocked, baseFree, baseLocked };
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
          'processed',
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
): Promise<
  {
    publicKey: PublicKey;
    context: { slot: number };
    accountInfo: AccountInfo<Buffer>;
  }[]
> {
  const len = publicKeys.length;
  if (len === 0) {
    return [];
  }
  if (len > 100) {
    const mid = Math.floor(publicKeys.length / 2);
    return Promise.all([
      getMultipleAccounts(connection, publicKeys.slice(0, mid), commitment),
      getMultipleAccounts(connection, publicKeys.slice(mid, len), commitment),
    ]).then((a) => a[0].concat(a[1]));
  }
  const publicKeyStrs = publicKeys.map((pk) => pk.toBase58());
  // load connection commitment as a default
  commitment ||= connection.commitment;

  const args = commitment ? [publicKeyStrs, { commitment }] : [publicKeyStrs];
  // @ts-ignore
  const resp = await connection._rpcRequest('getMultipleAccounts', args);
  if (resp.error) {
    throw new Error(resp.error.message);
  }
  return resp.result.value.map(
    ({ data, executable, lamports, owner }, i: number) => ({
      publicKey: publicKeys[i],
      context: resp.result.context,
      accountInfo: {
        data: Buffer.from(data[0], 'base64'),
        executable,
        owner: new PublicKey(owner),
        lamports,
      },
    }),
  );
}

/**
 * Throw if undefined; return value otherwise
 */
export function throwUndefined<T>(x: T | undefined): T {
  if (x === undefined) {
    throw new Error('Undefined');
  }
  return x;
}
