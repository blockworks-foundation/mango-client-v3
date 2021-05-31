import {
  Account,
  Connection,
  PublicKey,
  SimulatedTransactionResponse,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionConfirmationStatus,
  TransactionSignature,
  TransactionInstruction,
  SYSVAR_CLOCK_PUBKEY,
} from '@solana/web3.js';
import BN from 'bn.js';
import {
  awaitTransactionSignatureConfirmation,
  simulateTransaction,
  sleep,
  createAccountInstruction,
  createSignerKeyAndNonce,
  createTokenAccountInstructions,
} from './utils';
import {
  MerpsGroupLayout,
  encodeMerpsInstruction,
  NodeBankLayout,
  RootBankLayout,
  MerpsCacheLayout,
} from './layout';
import MerpsGroup from './MerpsGroup';

export const getUnixTs = () => {
  return new Date().getTime() / 1000;
};

export class MerpsClient {
  connection: Connection;
  programId: PublicKey;

  constructor(connection: Connection, programId: PublicKey) {
    this.connection = connection;
    this.programId = programId;
  }

  async sendTransactions(
    transactions: Transaction[],
    payer: Account,
    additionalSigners: Account[],
    timeout = 30000,
    confirmLevel: TransactionConfirmationStatus = 'confirmed',
  ): Promise<TransactionSignature[]> {
    return await Promise.all(
      transactions.map((tx) =>
        this.sendTransaction(
          tx,
          payer,
          additionalSigners,
          timeout,
          confirmLevel,
        ),
      ),
    );
  }

  async sendTransaction(
    transaction: Transaction,
    payer: Account,
    additionalSigners: Account[],
    timeout = 30000,
    confirmLevel: TransactionConfirmationStatus = 'confirmed',
  ): Promise<TransactionSignature> {
    transaction.recentBlockhash = (
      await this.connection.getRecentBlockhash('singleGossip')
    ).blockhash;
    transaction.setSigners(
      payer.publicKey,
      ...additionalSigners.map((a) => a.publicKey),
    );

    const signers = [payer].concat(additionalSigners);
    transaction.sign(...signers);
    const rawTransaction = transaction.serialize();
    const startTime = getUnixTs();

    const txid: TransactionSignature = await this.connection.sendRawTransaction(
      rawTransaction,
      { skipPreflight: true },
    );

    console.log('Started awaiting confirmation for', txid);
    let done = false;
    (async () => {
      while (!done && getUnixTs() - startTime < timeout / 1000) {
        this.connection.sendRawTransaction(rawTransaction, {
          skipPreflight: true,
        });
        await sleep(300);
      }
    })();

    try {
      await awaitTransactionSignatureConfirmation(
        txid,
        timeout,
        this.connection,
        confirmLevel,
      );
    } catch (err) {
      if (err.timeout) {
        throw new Error('Timed out awaiting confirmation on transaction');
      }
      let simulateResult: SimulatedTransactionResponse | null = null;
      try {
        simulateResult = (
          await simulateTransaction(
            this.connection,
            transaction,
            'singleGossip',
          )
        ).value;
      } catch (e) {}
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

  async initMerpsGroup(
    payer: Account,
    quoteMint: PublicKey,
    dexProgram: PublicKey,
    validInterval: number,
  ): Promise<PublicKey> {
    const accountInstruction = await createAccountInstruction(
      this.connection,
      payer.publicKey,
      MerpsGroupLayout.span,
      this.programId,
    );
    const { signerKey, signerNonce } = await createSignerKeyAndNonce(
      this.programId,
      accountInstruction.account.publicKey,
    );
    const newAccount = new Account();

    const quoteVaultAccountInstructions = await createTokenAccountInstructions(
      this.connection,
      payer.publicKey,
      newAccount.publicKey,
      quoteMint,
      signerKey,
    );

    const quoteNodeBankAccountInstruction = await createAccountInstruction(
      this.connection,
      payer.publicKey,
      NodeBankLayout.span,
      this.programId,
    );
    const quoteRootBankAccountInstruction = await createAccountInstruction(
      this.connection,
      payer.publicKey,
      RootBankLayout.span,
      this.programId,
    );
    const cacheAccountInstruction = await createAccountInstruction(
      this.connection,
      payer.publicKey,
      MerpsCacheLayout.span,
      this.programId,
    );

    const keys = [
      {
        isSigner: false,
        isWritable: true,
        pubkey: accountInstruction.account.publicKey,
      },
      { isSigner: false, isWritable: false, pubkey: SYSVAR_RENT_PUBKEY },
      { isSigner: false, isWritable: false, pubkey: signerKey },
      { isSigner: true, isWritable: false, pubkey: payer.publicKey },
      { isSigner: false, isWritable: false, pubkey: quoteMint },
      { isSigner: false, isWritable: true, pubkey: newAccount.publicKey },
      {
        isSigner: false,
        isWritable: true,
        pubkey: quoteNodeBankAccountInstruction.account.publicKey,
      },
      {
        isSigner: false,
        isWritable: true,
        pubkey: quoteRootBankAccountInstruction.account.publicKey,
      },
      {
        isSigner: false,
        isWritable: true,
        pubkey: cacheAccountInstruction.account.publicKey,
      },
      { isSigner: false, isWritable: false, pubkey: dexProgram },
    ];

    const data = encodeMerpsInstruction({
      InitMerpsGroup: {
        signerNonce: new BN(signerNonce),
        validInterval: new BN(validInterval),
      },
    });

    const initMerpsGroupInstruction = new TransactionInstruction({
      keys,
      data,
      programId: this.programId,
    });

    const transaction = new Transaction();
    transaction.add(accountInstruction.instruction);
    transaction.add(...quoteVaultAccountInstructions);
    transaction.add(quoteNodeBankAccountInstruction.instruction);
    transaction.add(quoteRootBankAccountInstruction.instruction);
    transaction.add(cacheAccountInstruction.instruction);
    transaction.add(initMerpsGroupInstruction);

    const txid = await this.sendTransaction(transaction, payer, [
      accountInstruction.account,
      newAccount,
      quoteNodeBankAccountInstruction.account,
      quoteRootBankAccountInstruction.account,
      cacheAccountInstruction.account,
    ]);

    return accountInstruction.account.publicKey;
  }

  async getMerpsGroup(merpsGroup: PublicKey): Promise<MerpsGroup> {
    const accountInfo = await this.connection.getAccountInfo(merpsGroup);
    const decoded = MerpsGroupLayout.decode(
      accountInfo == null ? undefined : accountInfo.data,
    );

    return new MerpsGroup(merpsGroup, decoded);
  }

  // Keeper functions
  async cacheRootBanks(
    payer: Account,
    merpsGroup: PublicKey,
    merpsCache: PublicKey,
  ): Promise<TransactionSignature> {
    const keys = [
      { isSigner: false, isWritable: false, pubkey: merpsGroup },
      { isSigner: false, isWritable: true, pubkey: merpsCache },
      { isSigner: false, isWritable: false, pubkey: SYSVAR_CLOCK_PUBKEY },
    ];

    const data = encodeMerpsInstruction({
      CacheRootBanks: {},
    });

    const cacheRootBanksInstruction = new TransactionInstruction({
      keys,
      data,
      programId: this.programId,
    });

    const transaction = new Transaction();
    transaction.add(cacheRootBanksInstruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async placePerpOrder(): Promise<TransactionSignature[]> {
    throw new Error('Not Implemented');
  }

  async cancelPerpOrder(): Promise<TransactionSignature[]> {
    throw new Error('Not Implemented');
  }
}
