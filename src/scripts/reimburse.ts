import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
} from '@solana/spl-token';
import {
  Commitment,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import BN from 'bn.js';
import { MangoClient } from '../client';
import { Cluster, Config } from '../config';
import fs from 'fs';

const PAYER_KEYPAIR = process.env.MB_PAYER_KEYPAIR;
const PAYER = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync(PAYER_KEYPAIR!, 'utf-8'))),
);
const SOURCE = PAYER.publicKey;

const config = Config.ids();
const cluster = 'mainnet' as Cluster;
const connection = new Connection(
  config.cluster_urls[cluster],
  'confirmed' as Commitment,
);

const groupName = 'mainnet.1';
const groupIds = config.getGroup(cluster, groupName);
if (!groupIds) {
  throw new Error(`Group ${groupName} not found`);
}

const mangoProgramId = groupIds.mangoProgramId;
const mangoGroupKey = groupIds.publicKey;
const client = new MangoClient(connection, mangoProgramId);

export async function createAssociatedTokenAccountIdempotentInstruction(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  ata: PublicKey,
): Promise<TransactionInstruction> {
  return new TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      {
        pubkey: SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: Buffer.from([0x1]),
  });
}

async function tokenTransfer(
  mangoAccountOwnerPk: PublicKey,
  mint: PublicKey,
  nativeTokenAmountToReimburse: BN,
) {
  const sourceAta = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    mint,
    SOURCE,
  );
  const destinationAta = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    mint,
    mangoAccountOwnerPk,
  );

  // Verify that this tx has not happend in last 100 txs for the destinationAta
  const sigs = await connection.getConfirmedSignaturesForAddress2(
    destinationAta,
  );
  for (const sig of sigs.slice(0, 100)) {
    const meta = await connection.getParsedTransaction(
      sig.signature,
      'confirmed',
    );

    // Simple check to see if the sourceAta was involved in a tx with destination ata
    if (
      meta?.transaction.message.accountKeys.find((accountKey) =>
        accountKey.pubkey.equals(sourceAta),
      )
    ) {
      console.log(` - already transferred`);
      return;
    }
  }

  // Build tx
  const tx = new Transaction();
  tx.add(
    await createAssociatedTokenAccountIdempotentInstruction(
      PAYER.publicKey,
      mangoAccountOwnerPk,
      mint,
      destinationAta,
    ),
  );
  tx.add(
    await Token.createTransferInstruction(
      TOKEN_PROGRAM_ID,
      sourceAta,
      await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        mint,
        mangoAccountOwnerPk,
      ),
      PAYER.publicKey,
      [PAYER],
      nativeTokenAmountToReimburse.toNumber(), // throws `Note: Blob.encode[amount] requires (length 8) Buffer as src` when BN is used
    ),
  );

  // Send and confirm
  const sig = await sendAndConfirmTransaction(connection, tx, [PAYER], {
    skipPreflight: true,
  });
  console.log(` - transferrd, sig https://explorer.solana.com/tx/${sig}`);
}

async function reimburseUser(
  mangoAccountOwnerPk: PublicKey,
  nativeTokenAmountsToReimburse: BN[],
): Promise<void> {
  const group = await client.getMangoGroup(mangoGroupKey);
  const allTokens = 16;

  // verify input from csv
  if (nativeTokenAmountsToReimburse.length !== allTokens) {
    throw new Error(
      `Mango V3 has ${allTokens} tokens, expected ${allTokens} token amounts to reimburse!`,
    );
  }

  group.tokens.map(async (token, tokenIndex) => {
    const tokenConfig = groupIds?.tokens.find((tokenConfig) =>
      token.mint.equals(tokenConfig.mintKey),
    );

    // Token slot empty
    if (!tokenConfig) {
      return;
    }

    // Token is deactivated
    if (token.oracleInactive) {
      return;
    }

    // Skip if no reimbursements for mint
    const nativeTokenAmountToReimburse =
      nativeTokenAmountsToReimburse[tokenIndex];
    if (nativeTokenAmountToReimburse.eq(new BN(0))) {
      return;
    }

    console.log(
      `Transferring ${nativeTokenAmountToReimburse} native ${tokenConfig.symbol} (mint - ${tokenConfig.mintKey}) to ${mangoAccountOwnerPk}`,
    );

    return await tokenTransfer(
      mangoAccountOwnerPk,
      token.mint,
      nativeTokenAmountToReimburse,
    );
  });
}

// Example
reimburseUser(new PublicKey('9Ut1gZJnd5D7EjPXm2DygYWZkZGpt5QSMEYAaVx2hur4'), [
  new BN(0),
  new BN(0),
  new BN(0),
  new BN(0),
  new BN(0),
  new BN(0),
  new BN(0),
  new BN(0),
  new BN(0),
  new BN(0),
  new BN(0),
  new BN(0),
  new BN(0),
  new BN(0),
  new BN(0),
  new BN(1), // USDC
]);

// TODO read csv, grab mango accounts owner, grab token deposits per token, call reimburseUser
