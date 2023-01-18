import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
} from '@solana/spl-token';
import * as path from 'path';
import * as csv from 'fast-csv';
import {
  Commitment,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import BN from 'bn.js';
import { MangoClient } from '../client';
import { Cluster, Config } from '../config';
import fs, { stat } from 'fs';
import _ from 'lodash';
import { sleep } from '@blockworks-foundation/mango-client';
import { bs58 } from '@project-serum/anchor/dist/cjs/utils/bytes';

const SEND_TRANSACTION_INTERVAL_MS = 10;
const TRANSACTION_RESEND_INTERVAL_S = 4;
const MAX_GET_SIGNATURE_STATUSES_QUERY_ITEMS = 256;

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

async function didTransferAlreadyHappen(
  sourceAta: PublicKey,
  destinationAta: PublicKey,
) {
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
      return true;
    }
  }
  return false;
}

async function buildTokenTransferIxs(
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

  return [
    await createAssociatedTokenAccountIdempotentInstruction(
      PAYER.publicKey,
      mangoAccountOwnerPk,
      mint,
      destinationAta,
    ),
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
      nativeTokenAmountToReimburse.toNumber(),
    ),
  ];
}

async function reimburseUser(
  mangoAccountOwnerPk: PublicKey,
  nativeTokenAmountsToReimburse: BN[],
): Promise<TransactionInstruction[]> {
  const group = await client.getMangoGroup(mangoGroupKey);
  const allTokens = 16;

  // verify input from csv
  if (nativeTokenAmountsToReimburse.length !== allTokens) {
    throw new Error(
      `Mango V3 has ${allTokens} tokens, expected ${allTokens} token amounts to reimburse!`,
    );
  }

  return (
    await Promise.all(
      group.tokens.map(async (token, tokenIndex) => {
        const tokenConfig = groupIds?.tokens.find((tokenConfig) =>
          token.mint.equals(tokenConfig.mintKey),
        );

        // Token slot empty
        if (!tokenConfig) {
          return [];
        }

        // Token is deactivated
        if (token.oracleInactive) {
          return [];
        }

        // Skip if no reimbursements for mint
        const nativeTokenAmountToReimburse =
          nativeTokenAmountsToReimburse[tokenIndex];
        if (nativeTokenAmountToReimburse.eq(new BN(0))) {
          return [];
        }

        // console.log(
        //   `Transferring ${nativeTokenAmountToReimburse} native ${tokenConfig.symbol} (mint - ${tokenConfig.mintKey}) to ${mangoAccountOwnerPk}`,
        // );

        return await buildTokenTransferIxs(
          mangoAccountOwnerPk,
          token.mint,
          nativeTokenAmountToReimburse,
        );
      }),
    )
  ).flatMap((res) => res);
}

async function main() {
  const rows: {
    owner: string;
    0: number;
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
    6: number;
    7: number;
    8: number;
    9: number;
    10: number;
    11: number;
    12: number;
    13: number;
    14: number;
    15: number;
  }[] = [];

  fs.createReadStream(path.resolve(__dirname, 'assets', 'output.csv'))
    .pipe(csv.parse({ headers: true }))
    .on('data', (row) => rows.push(row))
    .on('end', async (rowCount: number) => {
      if (rowCount != rows.length) {
        throw new Error('Error in aggregating all rows from the csv!');
      }

      // Split into batches, batches will be processed serially
      for (const rowChunk of _.chunk(rows, 2)) {
        // Each batch gets one blockhash which be attached to tx
        const latestBlockhash = await connection.getLatestBlockhash();

        const txContexts: { owners: string[]; tx: Transaction }[] =
          // Split batch further into chunks,
          // each chunk would correspond to one tx
          // chunk size should be chose such that all ixs from a chunk end up in one tx
          await Promise.all(
            _.chunk(rowChunk, 1).map(async (rowChunksChunk) => {
              const ixs = (
                await Promise.all(
                  rowChunksChunk.map(async (row) => {
                    return reimburseUser(new PublicKey(row.owner), [
                      new BN(row['0']),
                      new BN(row['1']),
                      new BN(row['2']),
                      new BN(row['3']),
                      new BN(row['4']),
                      new BN(row['5']),
                      new BN(row['6']),
                      new BN(row['7']),
                      new BN(row['8']),
                      new BN(row['9']),
                      new BN(row['10']),
                      new BN(row['11']),
                      new BN(row['12']),
                      new BN(row['13']),
                      new BN(row['14']),
                      new BN(row['15']),
                    ]);
                  }),
                )
              ).flatMap((res) => res);

              // Build tx
              const tx = new Transaction({
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
              });
              tx.add(
                ComputeBudgetProgram.requestUnits({
                  additionalFee: 5000,
                  units: 1.4e6,
                }),
              );
              tx.add(...ixs);

              return {
                owners: rowChunk.map((row) => row.owner),
                tx: tx,
              };
            }),
          );

        // Send txs, confirm them, retry if cannot be confirmed
        let expiredBlockhashRetries = 5;
        let blockHeight = await connection.getBlockHeight();
        while (expiredBlockhashRetries > 0) {
          const res = await connection.getLatestBlockhash();
          const lastValidBlockHeight = res.lastValidBlockHeight;

          const pendingTxContexts = new Map();
          for (const txContext of txContexts) {
            txContext.tx.sign(PAYER);
            if (!txContext.tx.signature) {
              throw new Error('Tx signature cannot be undefined!');
            }
            pendingTxContexts.set(
              bs58.encode(txContext.tx.signature),
              txContext,
            );
          }

          let lastResend = Date.now() / 1000 - TRANSACTION_RESEND_INTERVAL_S;
          while (blockHeight <= lastValidBlockHeight) {
            // Periodically re-send all pending transactions
            if (
              Date.now() / 1000 - lastResend >=
              TRANSACTION_RESEND_INTERVAL_S
            ) {
              for (const pendingTxContext of Array.from(
                pendingTxContexts.values(),
              )) {
                await connection.sendRawTransaction(
                  pendingTxContext.tx.serialize(),
                );
                // Maintain 100 TPS
                await sleep(SEND_TRANSACTION_INTERVAL_MS);
              }
              lastResend = Date.now() / 1000;
            }

            // Wait for the next block before checking for transaction statuses
            let blockHeightRefreshes = 10;
            let newBlockHeight = blockHeight;
            while (blockHeight == newBlockHeight && blockHeightRefreshes > 0) {
              await sleep(500);
              newBlockHeight = await connection.getBlockHeight();
              blockHeightRefreshes -= 1;
            }
            blockHeight = newBlockHeight;

            // Collect statuses for the transactions, drop those that are confirmed
            for (const pendingTxsChunk of _.chunk(
              Array.from(pendingTxContexts.keys()),
              MAX_GET_SIGNATURE_STATUSES_QUERY_ITEMS,
            )) {
              const statuses = await connection.getSignatureStatuses(
                pendingTxsChunk,
              );
              statuses.value.forEach((status, i) => {
                if (
                  status?.confirmationStatus &&
                  status.confirmationStatus === 'confirmed'
                ) {
                  pendingTxContexts.delete(pendingTxsChunk[i]);
                }
              });
            }
          }
        }
      }
    });
}

main();
