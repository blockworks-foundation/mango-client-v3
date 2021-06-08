import {
  Account,
  Commitment,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionSignature,
} from '@solana/web3.js';
import { sleep } from '../src/utils';

export const MerpsProgramId = new PublicKey(
  'G8WLEqRYYfe19tKYdTowPMT4DWJbUiKKxpHSiZLHtRAK',
);
export const DexProgramId = new PublicKey(
  'DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY',
);
export const USDCMint = new PublicKey(
  'H6hy7Ykzc43EuGivv7VVuUKNpKgUoFAfUY3wdPr4UyRX',
);
export async function _sendTransaction(
  connection: Connection,
  transaction: Transaction,
  signers: Account[],
): Promise<TransactionSignature> {
  await sleep(1000);
  const signature = await connection.sendTransaction(transaction, signers);
  try {
    await connection.confirmTransaction(signature);
  } catch (e) {
    console.info('Error while confirming, trying again');
    await connection.confirmTransaction(signature);
  }
  return signature;
}

export function createDevnetConnection() {
  return new Connection(
    'https://api.devnet.solana.com',
    'processed' as Commitment,
  );
}

export async function airdropSol(
  connection: Connection,
  account: Account,
  amount: number,
): Promise<void> {
  const roundedSolAmount = Math.round(amount);
  console.info(`Requesting ${roundedSolAmount} SOL`);
  const generousAccount = [
    115, 98, 128, 18, 66, 112, 147, 244, 46, 244, 118, 106, 91, 202, 56, 83, 58,
    71, 89, 226, 32, 177, 177, 240, 189, 23, 209, 176, 138, 119, 130, 140, 6,
    149, 55, 70, 215, 34, 108, 133, 225, 117, 38, 141, 74, 246, 232, 76, 176,
    10, 207, 221, 68, 179, 115, 158, 106, 133, 35, 30, 4, 177, 124, 5,
  ];
  const backupAcc = new Account(generousAccount);
  const tx = new Transaction();
  tx.add(
    SystemProgram.transfer({
      fromPubkey: backupAcc.publicKey,
      lamports: roundedSolAmount * 1e9,
      toPubkey: account.publicKey,
    }),
  );
  const signers = [backupAcc];
  const signerPks = signers.map((x) => x.publicKey);
  tx.setSigners(...signerPks);
  await _sendTransaction(connection, tx, signers);
}

export async function createAccount(
  connection,
  solBalance: number = 1,
): Promise<Account> {
  const account = new Account();
  if (solBalance >= 1) {
    await airdropSol(connection, account, solBalance);
  }
  return account;
}
