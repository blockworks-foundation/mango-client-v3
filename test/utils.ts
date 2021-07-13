import BN from 'bn.js';
import {
  DexInstructions,
  Market,
  TokenInstructions,
} from '@project-serum/serum';
import { u64 } from '@solana/spl-token';
import {
  Account,
  Commitment,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionSignature,
} from '@solana/web3.js';
import { StubOracleLayout } from '../src/layout';
import { createAccountInstruction, sleep } from '../src/utils';
import { msrmMints } from '../src';

export const MangoProgramId = new PublicKey(
  '32WeJ46tuY6QEkgydqzHYU5j85UT9m1cPJwFxPjuSVCt',
);
export const DexProgramId = new PublicKey(
  'DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY',
);
export const USDCMint = new PublicKey(
  'H6hy7Ykzc43EuGivv7VVuUKNpKgUoFAfUY3wdPr4UyRX',
);
export const MSRMMint = msrmMints['devnet'];
const FAUCET_PROGRAM_ID = new PublicKey(
  '4bXpkKSV8swHSnwqtzuboGPaPDeEgAn4Vt8GfarV5rZt',
);

const getPDA = () => {
  return PublicKey.findProgramAddress(
    [Buffer.from('faucet')],
    FAUCET_PROGRAM_ID,
  );
};

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

export async function createOracle(
  connection: Connection,
  programId: PublicKey,
  payer: Account,
): Promise<PublicKey> {
  const createOracleIns = await createAccountInstruction(
    connection,
    payer.publicKey,
    StubOracleLayout.span,
    programId,
  );
  const tx = new Transaction();
  tx.add(createOracleIns.instruction);

  const signers = [payer, createOracleIns.account];
  const signerPks = signers.map((x) => x.publicKey);
  tx.setSigners(...signerPks);
  await _sendTransaction(connection, tx, signers);
  return createOracleIns.account.publicKey;
}

export async function createAccount(
  connection: Connection,
  solBalance = 5,
): Promise<Account> {
  const account = new Account();
  if (solBalance >= 1) {
    await airdropSol(connection, account, solBalance);
  }
  return account;
}

export async function createTokenAccountWithBalance(
  connection: Connection,
  owner: Account,
  tokenMint: PublicKey,
  tokenDecimals: number,
  faucetId: PublicKey,
  amount: number,
) {
  const multiplier = Math.pow(10, tokenDecimals);
  const processedAmount = amount * multiplier;
  let ownedTokenAccountPk: PublicKey | null = null;
  ownedTokenAccountPk = await createTokenAccount(connection, tokenMint, owner);
  if (amount > 0) {
    await airdropTokens(
      connection,
      owner,
      faucetId,
      ownedTokenAccountPk,
      tokenMint,
      new u64(processedAmount),
    );
  }
  return ownedTokenAccountPk;
}

export async function airdropTokens(
  connection: Connection,
  feePayerAccount: Account,
  faucetPubkey: PublicKey,
  tokenDestinationPublicKey: PublicKey,
  mint: PublicKey,
  amount: u64,
) {
  const ix = await buildAirdropTokensIx(
    amount,
    mint,
    tokenDestinationPublicKey,
    faucetPubkey,
  );
  const tx = new Transaction();
  tx.add(ix);
  const signers = [feePayerAccount];
  await _sendTransaction(connection, tx, signers);
  return tokenDestinationPublicKey.toBase58();
}

export async function buildAirdropTokensIx(
  amount: u64,
  tokenMintPublicKey: PublicKey,
  destinationAccountPubkey: PublicKey,
  faucetPubkey: PublicKey,
) {
  const pubkeyNonce = await getPDA();
  const keys = [
    { pubkey: pubkeyNonce[0], isSigner: false, isWritable: false },
    { pubkey: tokenMintPublicKey, isSigner: false, isWritable: true },
    { pubkey: destinationAccountPubkey, isSigner: false, isWritable: true },
    {
      pubkey: TokenInstructions.TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: faucetPubkey, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({
    programId: FAUCET_PROGRAM_ID,
    data: Buffer.from([1, ...amount.toArray('le', 8)]),
    keys,
  });
}

export async function createTokenAccount(
  connection: Connection,
  mint: PublicKey,
  owner: Account,
): Promise<PublicKey> {
  const newAccount = new Account();
  const tx = new Transaction();
  const signers = [owner, newAccount];
  const signerPks = signers.map((x) => x.publicKey);
  tx.add(
    ...(await createTokenAccountInstrs(
      connection,
      newAccount.publicKey,
      mint,
      owner.publicKey,
    )),
  );
  tx.setSigners(...signerPks);
  await _sendTransaction(connection, tx, signers);
  return newAccount.publicKey;
}

export async function createTokenAccountInstrs(
  connection: Connection,
  newAccountPubkey: PublicKey,
  mint: PublicKey,
  ownerPk: PublicKey,
  lamports?: number,
): Promise<TransactionInstruction[]> {
  if (lamports === undefined)
    lamports = await connection.getMinimumBalanceForRentExemption(165);
  return [
    SystemProgram.createAccount({
      fromPubkey: ownerPk,
      newAccountPubkey,
      space: 165,
      lamports,
      programId: TokenInstructions.TOKEN_PROGRAM_ID,
    }),
    TokenInstructions.initializeAccount({
      account: newAccountPubkey,
      mint,
      owner: ownerPk,
    }),
  ];
}

export async function listMarket(
  connection: Connection,
  payer: Account,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  baseLotSize: number,
  quoteLotSize: number,
  dexProgramId: PublicKey,
): Promise<PublicKey> {
  const market = new Account();
  const requestQueue = new Account();
  const eventQueue = new Account();
  const bids = new Account();
  const asks = new Account();
  const baseVault = new Account();
  const quoteVault = new Account();
  const feeRateBps = 0;
  const quoteDustThreshold = new BN(100);

  async function getVaultOwnerAndNonce() {
    const nonce = new BN(0);
    while (true) {
      try {
        const vaultOwner = await PublicKey.createProgramAddress(
          [market.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)],
          dexProgramId,
        );
        return [vaultOwner, nonce];
      } catch (e) {
        nonce.iaddn(1);
      }
    }
  }
  const [vaultOwner, vaultSignerNonce] = await getVaultOwnerAndNonce();

  const tx1 = new Transaction();
  tx1.add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: baseVault.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(165),
      space: 165,
      programId: TokenInstructions.TOKEN_PROGRAM_ID,
    }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: quoteVault.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(165),
      space: 165,
      programId: TokenInstructions.TOKEN_PROGRAM_ID,
    }),
    TokenInstructions.initializeAccount({
      account: baseVault.publicKey,
      mint: baseMint,
      owner: vaultOwner,
    }),
    TokenInstructions.initializeAccount({
      account: quoteVault.publicKey,
      mint: quoteMint,
      owner: vaultOwner,
    }),
  );

  const tx2 = new Transaction();
  tx2.add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: market.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(
        Market.getLayout(dexProgramId).span,
      ),
      space: Market.getLayout(dexProgramId).span,
      programId: dexProgramId,
    }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: requestQueue.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(5120 + 12),
      space: 5120 + 12,
      programId: dexProgramId,
    }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: eventQueue.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(262144 + 12),
      space: 262144 + 12,
      programId: dexProgramId,
    }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: bids.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(65536 + 12),
      space: 65536 + 12,
      programId: dexProgramId,
    }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: asks.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(65536 + 12),
      space: 65536 + 12,
      programId: dexProgramId,
    }),
    DexInstructions.initializeMarket({
      market: market.publicKey,
      requestQueue: requestQueue.publicKey,
      eventQueue: eventQueue.publicKey,
      bids: bids.publicKey,
      asks: asks.publicKey,
      baseVault: baseVault.publicKey,
      quoteVault: quoteVault.publicKey,
      baseMint,
      quoteMint,
      baseLotSize: new BN(baseLotSize),
      quoteLotSize: new BN(quoteLotSize),
      feeRateBps,
      vaultSignerNonce,
      quoteDustThreshold,
      programId: dexProgramId,
    }),
  );
  await _sendTransaction(connection, tx1, [payer, baseVault, quoteVault]);
  await _sendTransaction(connection, tx2, [payer, market, requestQueue, eventQueue, bids, asks]);

  return market.publicKey;
}
