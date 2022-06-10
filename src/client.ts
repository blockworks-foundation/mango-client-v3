import {
  AccountInfo,
  BlockhashWithExpiryBlockHeight,
  Commitment,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  RpcResponseAndContext,
  SignatureStatus,
  SimulatedTransactionResponse,
  SystemProgram,
  Transaction,
  TransactionConfirmationStatus,
  TransactionSignature,
} from '@solana/web3.js';
import BN from 'bn.js';
import fetch from 'cross-fetch';
import {
  createAccountInstruction,
  createSignerKeyAndNonce,
  createTokenAccountInstructions,
  getFilteredProgramAccounts,
  getMultipleAccounts,
  I64_MAX_BN,
  nativeToUi,
  promiseNull,
  promiseUndef,
  simulateTransaction,
  sleep,
  MangoError,
  U64_MAX_BN,
  TimeoutError,
  uiToNative,
  ZERO_BN,
  zeroKey,
  MAXIMUM_NUMBER_OF_BLOCKS_FOR_TRANSACTION,
} from './utils/utils';
import {
	AssetType,
	BookSideLayout,
	CENTIBPS_PER_UNIT,
	FREE_ORDER_SLOT,
	INFO_LEN,
	MangoAccountLayout,
	MangoCache,
	MangoCacheLayout,
	MangoGroupLayout,
	NodeBankLayout,
	PerpEventLayout,
	PerpEventQueueHeaderLayout,
	PerpMarketLayout,
	QUOTE_INDEX,
	RootBankLayout,
	StubOracleLayout,
} from './layout';
import MangoAccount from './MangoAccount';
import PerpMarket from './PerpMarket';
import RootBank from './RootBank';
import {
  makeAddMangoAccountInfoInstruction,
  makeAddOracleInstruction,
  makeAddPerpMarketInstruction,
  makeAddPerpTriggerOrderInstruction,
  makeAddSpotMarketInstruction,
  makeCachePerpMarketsInstruction,
  makeCachePricesInstruction,
  makeCacheRootBankInstruction,
  makeCancelAllPerpOrdersInstruction,
  makeCancelPerpOrderInstruction,
  makeCancelPerpOrdersSideInstruction,
  makeCancelSpotOrderInstruction,
  makeChangePerpMarketParams2Instruction,
  makeChangePerpMarketParamsInstruction,
  makeChangeReferralFeeParamsInstruction,
  makeChangeSpotMarketParamsInstruction,
  makeCloseAdvancedOrdersInstruction,
  makeCloseMangoAccountInstruction,
  makeCloseSpotOpenOrdersInstruction,
  makeConsumeEventsInstruction,
  makeCreateDustAccountInstruction,
  makeCreateMangoAccountInstruction,
  makeCreatePerpMarketInstruction,
  makeDepositInstruction,
  makeDepositMsrmInstruction,
  makeExecutePerpTriggerOrderInstruction,
  makeForceCancelPerpOrdersInstruction,
  makeForceCancelSpotOrdersInstruction,
  makeInitAdvancedOrdersInstruction,
  makeInitMangoAccountInstruction,
  makeInitMangoGroupInstruction,
  makeInitSpotOpenOrdersInstruction,
  makeLiquidatePerpMarketInstruction,
  makeLiquidateTokenAndPerpInstruction,
  makeLiquidateTokenAndTokenInstruction,
  makePlacePerpOrder2Instruction,
  makePlacePerpOrderInstruction,
  makePlaceSpotOrder2Instruction,
  makePlaceSpotOrderInstruction,
  makeRedeemMngoInstruction,
  makeRegisterReferrerIdInstruction,
  makeRemoveAdvancedOrderInstruction,
  makeResolveDustInstruction,
  makeResolvePerpBankruptcyInstruction,
  makeResolveTokenBankruptcyInstruction,
  makeSetDelegateInstruction,
  makeSetGroupAdminInstruction,
  makeSetOracleInstruction,
  makeSetReferrerMemoryInstruction,
  makeSettleFeesInstruction,
  makeSettleFundsInstruction,
  makeSettlePnlInstruction,
  makeUpdateFundingInstruction,
  makeUpdateMarginBasketInstruction,
  makeUpdateRootBankInstruction,
  makeUpgradeMangoAccountV0V1Instruction,
  makeWithdrawInstruction,
  makeWithdrawMsrmInstruction,
  makeCancelAllSpotOrdersInstruction,
} from './instruction';
import {
	getFeeRates,
	getFeeTier,
	Market,
	OpenOrders,
} from '@project-serum/serum';
import {I80F48, ONE_I80F48, ZERO_I80F48} from './utils/fixednum';
import {Order} from '@project-serum/serum/lib/market';

import { PerpOrderType, Payer } from './utils/types';
import { adapterHasSignAllTransactions } from './utils/adapterTypes';
import { BookSide, PerpOrder } from './book';
import {
	closeAccount,
	initializeAccount,
	WRAPPED_SOL_MINT,
} from '@project-serum/serum/lib/token-instructions';
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	Token,
	TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import MangoGroup from './MangoGroup';
import { makeCreateSpotOpenOrdersInstruction } from './instruction';
import { ReferrerIdRecord, ReferrerIdRecordLayout } from './layout';
import * as bs58 from 'bs58';

/**
 * Get the current epoch timestamp in seconds with microsecond precision
 */
export const getUnixTs = () => {
	return new Date().getTime() / 1000;
};

type AccountWithPnl = {
	publicKey: PublicKey;
	pnl: I80F48;
};

/**
 * A class for interacting with the Mango V3 Program
 *
 * @param connection A solana web.js Connection object
 * @param programId The PublicKey of the Mango V3 Program
 * @param opts An object used to configure the MangoClient. Accepts a postSendTxCallback
 */
export class MangoClient {
  connection: Connection;
  sendConnection?: Connection;
  programId: PublicKey;
  lastSlot: number;
  lastValidBlockHeight: number;
  timeout: number | null;
  // The commitment level used when fetching recentBlockHash
  blockhashCommitment: Commitment;
  postSendTxCallback?: ({ txid: string }) => void;

  constructor(
    connection: Connection,
    programId: PublicKey,
    opts: {
      postSendTxCallback?: ({ txid }: { txid: string }) => void;
      maxStoredBlockhashes?: number;
      blockhashCommitment?: Commitment;
      timeout?: number;
      sendConnection?: Connection;
    } = {},
  ) {
    this.connection = connection;
    this.programId = programId;
    this.lastSlot = 0;
    this.lastValidBlockHeight = 0;
    this.blockhashCommitment = opts?.blockhashCommitment || 'confirmed';
    this.timeout = opts?.timeout || 60000;
    this.sendConnection = opts.sendConnection;
    if (opts.postSendTxCallback) {
      this.postSendTxCallback = opts.postSendTxCallback;
    }
  }

  async sendTransactions(
    transactions: Transaction[],
    payer: Payer,
    additionalSigners: Keypair[],
    timeout: number | null = this.timeout,
    confirmLevel: TransactionConfirmationStatus = 'processed',
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

  async getCurrentBlockhash(): Promise<BlockhashWithExpiryBlockHeight> {
    let currentBlockhash = await this.connection.getLatestBlockhash(
      this.blockhashCommitment,
    );

    return currentBlockhash;
  }

  async signTransaction({
    transaction,
    payer,
    signers,
    currentBlockhash,
  }: {
    transaction: Transaction;
    payer: any;
    signers: Array<Keypair>;
    currentBlockhash?: BlockhashWithExpiryBlockHeight;
  }) {
    let blockhashWithExpiryBlockHeight: BlockhashWithExpiryBlockHeight =
      currentBlockhash ? currentBlockhash : await this.getCurrentBlockhash();

    transaction.recentBlockhash = blockhashWithExpiryBlockHeight.blockhash;
    transaction.setSigners(payer.publicKey, ...signers.map((s) => s.publicKey));
    if (signers.length > 0) {
      transaction.partialSign(...signers);
    }

    if (payer?.connected) {
      console.log('signing as wallet', payer.publicKey);
      return await payer.signTransaction(transaction);
    } else {
      transaction.sign(...[payer].concat(signers));
    }
  }

  async signTransactions({
    transactionsAndSigners,
    payer,
    currentBlockhash,
  }: {
    transactionsAndSigners: {
      transaction: Transaction;
      signers?: Array<Keypair>;
    }[];
    payer: Payer;
    currentBlockhash?: BlockhashWithExpiryBlockHeight;
  }) {
    if (!payer.publicKey) {
      return;
    }
    let blockhashWithExpiryBlockHeight: BlockhashWithExpiryBlockHeight =
      currentBlockhash ? currentBlockhash : await this.getCurrentBlockhash();
    transactionsAndSigners.forEach(({ transaction, signers = [] }) => {
      transaction.recentBlockhash = blockhashWithExpiryBlockHeight.blockhash;
      if (payer.publicKey) {
        transaction.setSigners(
          payer.publicKey,
          ...signers.map((s) => s.publicKey),
        );
      }
      if (signers?.length > 0) {
        transaction.partialSign(...signers);
      }
    });
    if (adapterHasSignAllTransactions(payer)) {
      return await payer.signAllTransactions(
        transactionsAndSigners.map(({ transaction }) => transaction),
      );
    } else {
      transactionsAndSigners.forEach(({ transaction, signers }) => {
        // @ts-ignore
        transaction.sign(...[payer].concat(signers));
      });
      return transactionsAndSigners.map((t) => t.transaction);
    }
  }
  /**
   * Send a transaction using the Solana Web3.js connection on the mango client
   *
   * @param transaction
   * @param payer
   * @param additionalSigners
   * @param timeout Retries sending the transaction and trying to confirm it until the given timeout. Passing null will disable the transaction confirmation check and always return success.
   */
  async sendTransaction(
    transaction: Transaction,
    payer: Payer,
    additionalSigners: Keypair[],
    timeout: number | null = this.timeout,
    confirmLevel: TransactionConfirmationStatus = 'processed',
  ): Promise<TransactionSignature> {
    const currentBlockhash = await this.getCurrentBlockhash();
    await this.signTransaction({
      transaction,
      payer,
      signers: additionalSigners,
      currentBlockhash,
    });
    const rawTransaction = transaction.serialize();
    let txid = bs58.encode(transaction.signatures[0].signature);
    const startTime = getUnixTs();

    if (this.sendConnection) {
      const promise = this.sendConnection.sendRawTransaction(rawTransaction);
      if (this.postSendTxCallback) {
        try {
          this.postSendTxCallback({ txid });
        } catch (e) {
          console.warn(`postSendTxCallback error ${e}`);
        }
      }
      try {
        return await promise;
      } catch (e) {
        console.error(e);
        throw new MangoError({ message: 'Transaction failed', txid });
      }
    } else {
      txid = await this.connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
      });

      if (this.postSendTxCallback) {
        try {
          this.postSendTxCallback({ txid });
        } catch (e) {
          console.warn(`postSendTxCallback error ${e}`);
        }
      }

      if (!timeout) return txid;

      console.log(
        'Started awaiting confirmation for',
        txid,
        'size:',
        rawTransaction.length,
      );

      let done = false;
      let retryAttempts = 0;
      const retrySleep = 2000;
      const maxRetries = 30;
      (async () => {
        while (!done && getUnixTs() - startTime < timeout / 1000) {
          await sleep(retrySleep);
          // console.log(new Date().toUTCString(), ' sending tx ', txid);
          this.connection.sendRawTransaction(rawTransaction, {
            skipPreflight: true,
          });
          if (retryAttempts <= maxRetries) {
            retryAttempts = retryAttempts++;
          } else {
            break;
          }
        }
      })();

      try {
        await this.awaitTransactionSignatureConfirmation(
          txid,
          timeout,
          confirmLevel,
          currentBlockhash,
        );
      } catch (err: any) {
        if (err.timeout) {
          throw new TimeoutError({ txid });
        }
        let simulateResult: SimulatedTransactionResponse | null = null;
        try {
          simulateResult = (
            await simulateTransaction(this.connection, transaction, 'processed')
          ).value;
        } catch (e) {
          console.warn('Simulate transaction failed');
        }

        if (simulateResult && simulateResult.err) {
          if (simulateResult.logs) {
            for (let i = simulateResult.logs.length - 1; i >= 0; --i) {
              const line = simulateResult.logs[i];
              if (line.startsWith('Program log: ')) {
                throw new MangoError({
                  message:
                    'Transaction failed: ' + line.slice('Program log: '.length),
                  txid,
                });
              }
            }
          }
          throw new MangoError({
            message: JSON.stringify(simulateResult.err),
            txid,
          });
        }
        throw new MangoError({ message: 'Transaction failed', txid });
      } finally {
        done = true;
      }
    }

    console.log('Latency', getUnixTs() - startTime, txid);
    return txid;
  }

  async sendSignedTransaction({
    signedTransaction,
    timeout = this.timeout,
    confirmLevel = 'processed',
    signedAtBlock,
  }: {
    signedTransaction: Transaction;
    timeout?: number | null;
    confirmLevel?: TransactionConfirmationStatus;
    signedAtBlock?: BlockhashWithExpiryBlockHeight;
  }): Promise<TransactionSignature> {
    const rawTransaction = signedTransaction.serialize();
    let txid = bs58.encode(signedTransaction.signatures[0].signature);
    const startTime = getUnixTs();

    if (this.sendConnection) {
      const promise = this.sendConnection.sendRawTransaction(rawTransaction);
      if (this.postSendTxCallback) {
        try {
          this.postSendTxCallback({ txid });
        } catch (e) {
          console.warn(`postSendTxCallback error ${e}`);
        }
      }
      try {
        return await promise;
      } catch (e) {
        console.error(e);
        throw new MangoError({ message: 'Transaction failed', txid });
      }
    } else {
      txid = await this.connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
      });

      if (this.postSendTxCallback) {
        try {
          this.postSendTxCallback({ txid });
        } catch (e) {
          console.log(`postSendTxCallback error ${e}`);
        }
      }
      if (!timeout) return txid;

      let done = false;
      (async () => {
        while (!done && getUnixTs() - startTime < timeout) {
          await sleep(2000);
          this.connection.sendRawTransaction(rawTransaction, {
            skipPreflight: true,
          });
        }
      })();
      try {
        await this.awaitTransactionSignatureConfirmation(
          txid,
          timeout,
          confirmLevel,
          signedAtBlock,
        );
      } catch (err: any) {
        if (err.timeout) {
          throw new TimeoutError({ txid });
        }
        let simulateResult: SimulatedTransactionResponse | null = null;
        try {
          simulateResult = (
            await simulateTransaction(
              this.connection,
              signedTransaction,
              'single',
            )
          ).value;
        } catch (e) {
          console.log('Simulate tx failed');
        }
        if (simulateResult && simulateResult.err) {
          if (simulateResult.logs) {
            for (let i = simulateResult.logs.length - 1; i >= 0; --i) {
              const line = simulateResult.logs[i];
              if (line.startsWith('Program log: ')) {
                throw new MangoError({
                  message:
                    'Transaction failed: ' + line.slice('Program log: '.length),
                  txid,
                });
              }
            }
          }
          throw new MangoError({
            message: JSON.stringify(simulateResult.err),
            txid,
          });
        }
        throw new MangoError({ message: 'Transaction failed', txid });
      } finally {
        done = true;
      }
      return txid;
    }
  }

  async awaitTransactionSignatureConfirmation(
    txid: TransactionSignature,
    timeout: number,
    confirmLevel: TransactionConfirmationStatus,
    signedAtBlock?: BlockhashWithExpiryBlockHeight,
  ) {
    const timeoutBlockHeight = signedAtBlock
      ? signedAtBlock.lastValidBlockHeight +
        MAXIMUM_NUMBER_OF_BLOCKS_FOR_TRANSACTION
      : 0;
    let startTimeoutCheck = false;
    let done = false;
    const confirmLevels: (TransactionConfirmationStatus | null | undefined)[] =
      ['finalized'];

    if (confirmLevel === 'confirmed') {
      confirmLevels.push('confirmed');
    } else if (confirmLevel === 'processed') {
      confirmLevels.push('confirmed');
      confirmLevels.push('processed');
    }
    let subscriptionId: number | undefined;

    const result = await new Promise((resolve, reject) => {
      (async () => {
        setTimeout(() => {
          if (done) {
            return;
          }
          if (timeoutBlockHeight !== 0) {
            startTimeoutCheck = true;
          } else {
            done = true;
            console.log('Timed out for txid: ', txid);
            reject({ timeout: true });
          }
        }, timeout);
        try {
          subscriptionId = this.connection.onSignature(
            txid,
            (result, context) => {
              subscriptionId = undefined;
              done = true;
              if (result.err) {
                reject(result.err);
              } else {
                this.lastSlot = context?.slot;
                resolve(result);
              }
            },
            'processed',
          );
        } catch (e) {
          done = true;
          console.log('WS error in setup', txid, e);
        }
        let retrySleep = 2000;
        while (!done) {
          // eslint-disable-next-line no-loop-func
          await sleep(retrySleep);
          (async () => {
            try {
              const promises: [
                Promise<RpcResponseAndContext<(SignatureStatus | null)[]>>,
                Promise<number>?,
              ] = [this.connection.getSignatureStatuses([txid])];
              //if startTimeoutThreshold passed we start to check if
              //current blocks are did not passed timeoutBlockHeight threshold
              if (startTimeoutCheck) {
                promises.push(this.connection.getBlockHeight('confirmed'));
              }
              const [signatureStatuses, currentBlockHeight] = await Promise.all(
                promises,
              );
              if (
                typeof currentBlockHeight !== undefined &&
                timeoutBlockHeight <= currentBlockHeight!
              ) {
                console.log('Timed out for txid: ', txid);
                done = true;
                reject({ timeout: true });
              }

              const result = signatureStatuses && signatureStatuses.value[0];
              if (!done) {
                if (!result) return;
                if (result.err) {
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
                  this.lastSlot = signatureStatuses?.context?.slot;
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
        }
      })();
    });

    if (subscriptionId) {
      this.connection.removeSignatureListener(subscriptionId).catch((e) => {
        console.log('WS error in cleanup', e);
      });
    }

    done = true;
    return result;
  }

  /**
   * Create a new Mango group
   */
  async initMangoGroup(
    quoteMint: PublicKey,
    msrmMint: PublicKey,
    dexProgram: PublicKey,
    feesVault: PublicKey, // owned by Mango DAO token governance
    validInterval: number,
    quoteOptimalUtil: number,
    quoteOptimalRate: number,
    quoteMaxRate: number,
    payer: Payer,
  ): Promise<PublicKey | undefined> {
    if (!payer.publicKey) {
      return;
    }
    const accountInstruction = await createAccountInstruction(
      this.connection,
      payer.publicKey,
      MangoGroupLayout.span,
      this.programId,
    );
    const { signerKey, signerNonce } = await createSignerKeyAndNonce(
      this.programId,
      accountInstruction.account.publicKey,
    );
    const quoteVaultAccount = new Keypair();

    const quoteVaultAccountInstructions = await createTokenAccountInstructions(
      this.connection,
      payer.publicKey,
      quoteVaultAccount.publicKey,
      quoteMint,
      signerKey,
    );

    const insuranceVaultAccount = new Keypair();
    const insuranceVaultAccountInstructions =
      await createTokenAccountInstructions(
        this.connection,
        payer.publicKey,
        insuranceVaultAccount.publicKey,
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
      MangoCacheLayout.span,
      this.programId,
    );

    const createAccountsTransaction = new Transaction();
    createAccountsTransaction.add(accountInstruction.instruction);
    createAccountsTransaction.add(...quoteVaultAccountInstructions);
    createAccountsTransaction.add(quoteNodeBankAccountInstruction.instruction);
    createAccountsTransaction.add(quoteRootBankAccountInstruction.instruction);
    createAccountsTransaction.add(cacheAccountInstruction.instruction);
    createAccountsTransaction.add(...insuranceVaultAccountInstructions);

    const signers = [
      accountInstruction.account,
      quoteVaultAccount,
      quoteNodeBankAccountInstruction.account,
      quoteRootBankAccountInstruction.account,
      cacheAccountInstruction.account,
      insuranceVaultAccount,
    ];
    await this.sendTransaction(createAccountsTransaction, payer, signers);

    // If valid msrmMint passed in, then create new msrmVault
    let msrmVaultPk;
    if (!msrmMint.equals(zeroKey)) {
      const msrmVaultAccount = new Keypair();
      const msrmVaultAccountInstructions = await createTokenAccountInstructions(
        this.connection,
        payer.publicKey,
        msrmVaultAccount.publicKey,
        msrmMint,
        signerKey,
      );
      const createMsrmVaultTransaction = new Transaction();
      createMsrmVaultTransaction.add(...msrmVaultAccountInstructions);
      msrmVaultPk = msrmVaultAccount.publicKey;
      await this.sendTransaction(createMsrmVaultTransaction, payer, [
        msrmVaultAccount,
      ]);
    } else {
      msrmVaultPk = zeroKey;
    }

    const initMangoGroupInstruction = makeInitMangoGroupInstruction(
      this.programId,
      accountInstruction.account.publicKey,
      signerKey,
      payer.publicKey,
      quoteMint,
      quoteVaultAccount.publicKey,
      quoteNodeBankAccountInstruction.account.publicKey,
      quoteRootBankAccountInstruction.account.publicKey,
      insuranceVaultAccount.publicKey,
      msrmVaultPk,
      feesVault,
      cacheAccountInstruction.account.publicKey,
      dexProgram,
      new BN(signerNonce),
      new BN(validInterval),
      I80F48.fromNumber(quoteOptimalUtil),
      I80F48.fromNumber(quoteOptimalRate),
      I80F48.fromNumber(quoteMaxRate),
    );

    const initMangoGroupTransaction = new Transaction();
    initMangoGroupTransaction.add(initMangoGroupInstruction);
    await this.sendTransaction(initMangoGroupTransaction, payer, []);

    return accountInstruction.account.publicKey;
  }

  /**
   * Retrieve information about a Mango Group
   */
  async getMangoGroup(mangoGroup: PublicKey): Promise<MangoGroup> {
    const accountInfo = await this.connection.getAccountInfo(mangoGroup);
    const decoded = MangoGroupLayout.decode(
      accountInfo == null ? undefined : accountInfo.data,
    );

    return new MangoGroup(mangoGroup, decoded);
  }

  /**
   * DEPRECATED - Create a new Mango Account on a given group
   */
  async initMangoAccount(
    mangoGroup: MangoGroup,
    owner: Payer,
  ): Promise<PublicKey | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const accountInstruction = await createAccountInstruction(
      this.connection,
      owner.publicKey,
      MangoAccountLayout.span,
      this.programId,
    );

    const initMangoAccountInstruction = makeInitMangoAccountInstruction(
      this.programId,
      mangoGroup.publicKey,
      accountInstruction.account.publicKey,
      owner.publicKey,
    );

    // Add all instructions to one atomic transaction
    const transaction = new Transaction();
    transaction.add(accountInstruction.instruction);
    transaction.add(initMangoAccountInstruction);

    const additionalSigners = [accountInstruction.account];
    await this.sendTransaction(transaction, owner, additionalSigners);

    return accountInstruction.account.publicKey;
  }

  /**
   * Create a new Mango Account (PDA) on a given group
   */
  async createMangoAccount(
    mangoGroup: MangoGroup,
    owner: Payer,
    accountNum: number,
    payerPk?: PublicKey,
  ): Promise<PublicKey | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const payer = payerPk ?? owner.publicKey;
    const accountNumBN = new BN(accountNum);
    const [mangoAccountPk] = await PublicKey.findProgramAddress(
      [
        mangoGroup.publicKey.toBytes(),
        owner.publicKey.toBytes(),
        accountNumBN.toBuffer('le', 8),
      ],
      this.programId,
    );

    const createMangoAccountInstruction = makeCreateMangoAccountInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccountPk,
      owner.publicKey,
      accountNumBN,
      payer,
    );

    // Add all instructions to one atomic transaction
    const transaction = new Transaction();
    transaction.add(createMangoAccountInstruction);

    await this.sendTransaction(transaction, owner, []);

    return mangoAccountPk;
  }

  /**
   * Upgrade a Mango Account from V0 (not deletable) to V1 (deletable)
   */
  async upgradeMangoAccountV0V1(
    mangoGroup: MangoGroup,
    owner: Payer,
    accountNum: number,
  ): Promise<PublicKey | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const accountNumBN = new BN(accountNum);
    const [mangoAccountPk] = await PublicKey.findProgramAddress(
      [
        mangoGroup.publicKey.toBytes(),
        owner.publicKey.toBytes(),
        accountNumBN.toBuffer(),
      ],
      this.programId,
    );

    const upgradeMangoAccountInstruction =
      makeUpgradeMangoAccountV0V1Instruction(
        this.programId,
        mangoGroup.publicKey,
        mangoAccountPk,
        owner.publicKey,
      );

    const transaction = new Transaction();
    transaction.add(upgradeMangoAccountInstruction);

    await this.sendTransaction(transaction, owner, []);

    return mangoAccountPk;
  }

  /**
   * Retrieve information about a Mango Account
   */
  async getMangoAccount(
    mangoAccountPk: PublicKey,
    dexProgramId: PublicKey,
  ): Promise<MangoAccount> {
    const acc = await this.connection.getAccountInfo(
      mangoAccountPk,
      'processed',
    );
    const mangoAccount = new MangoAccount(
      mangoAccountPk,
      MangoAccountLayout.decode(acc == null ? undefined : acc.data),
    );
    await mangoAccount.loadOpenOrders(this.connection, dexProgramId);
    return mangoAccount;
  }

  /**
   * Create a new Mango Account and deposit some tokens in a single transaction
   *
   * @param rootBank The RootBank for the deposit currency
   * @param nodeBank The NodeBank asociated with the RootBank
   * @param vault The token account asociated with the NodeBank
   * @param tokenAcc The token account to transfer from
   * @param info An optional UI name for the account
   */
  async initMangoAccountAndDeposit(
    mangoGroup: MangoGroup,
    owner: Payer,
    rootBank: PublicKey,
    nodeBank: PublicKey,
    vault: PublicKey,
    tokenAcc: PublicKey,

    quantity: number,
    info?: string,
  ): Promise<string | undefined> {
    if (!owner.publicKey) {
      return;
    }

    const transaction = new Transaction();
    const accountInstruction = await createAccountInstruction(
      this.connection,
      owner.publicKey,
      MangoAccountLayout.span,
      this.programId,
    );

    const initMangoAccountInstruction = makeInitMangoAccountInstruction(
      this.programId,
      mangoGroup.publicKey,
      accountInstruction.account.publicKey,
      owner.publicKey,
    );

    transaction.add(accountInstruction.instruction);
    transaction.add(initMangoAccountInstruction);

    const additionalSigners = [accountInstruction.account];

    const tokenIndex = mangoGroup.getRootBankIndex(rootBank);
    const tokenMint = mangoGroup.tokens[tokenIndex].mint;

    let wrappedSolAccount: Keypair | null = null;
    if (
      tokenMint.equals(WRAPPED_SOL_MINT) &&
      tokenAcc.toBase58() === owner.publicKey.toBase58()
    ) {
      wrappedSolAccount = new Keypair();
      const lamports = Math.round(quantity * LAMPORTS_PER_SOL) + 1e7;
      transaction.add(
        SystemProgram.createAccount({
          fromPubkey: owner.publicKey,
          newAccountPubkey: wrappedSolAccount.publicKey,
          lamports,
          space: 165,
          programId: TOKEN_PROGRAM_ID,
        }),
      );

      transaction.add(
        initializeAccount({
          account: wrappedSolAccount.publicKey,
          mint: WRAPPED_SOL_MINT,
          owner: owner.publicKey,
        }),
      );

      additionalSigners.push(wrappedSolAccount);
    }

    const nativeQuantity = uiToNative(
      quantity,
      mangoGroup.tokens[tokenIndex].decimals,
    );

    const instruction = makeDepositInstruction(
      this.programId,
      mangoGroup.publicKey,
      owner.publicKey,
      mangoGroup.mangoCache,
      accountInstruction.account.publicKey,
      rootBank,
      nodeBank,
      vault,
      wrappedSolAccount?.publicKey ?? tokenAcc,
      nativeQuantity,
    );
    transaction.add(instruction);

    if (info) {
      const addAccountNameinstruction = makeAddMangoAccountInfoInstruction(
        this.programId,
        mangoGroup.publicKey,
        accountInstruction.account.publicKey,
        owner.publicKey,
        info,
      );
      transaction.add(addAccountNameinstruction);
    }

    if (wrappedSolAccount) {
      transaction.add(
        closeAccount({
          source: wrappedSolAccount.publicKey,
          destination: owner.publicKey,
          owner: owner.publicKey,
        }),
      );
    }

    await this.sendTransaction(transaction, owner, additionalSigners);

    return accountInstruction.account.publicKey.toString();
  }

  /**
   * Create a new Mango Account (PDA) and deposit some tokens in a single transaction
   *
   * @param rootBank The RootBank for the deposit currency
   * @param nodeBank The NodeBank asociated with the RootBank
   * @param vault The token account asociated with the NodeBank
   * @param tokenAcc The token account to transfer from
   * @param info An optional UI name for the account
   */
  async createMangoAccountAndDeposit(
    mangoGroup: MangoGroup,
    owner: Payer,
    rootBank: PublicKey,
    nodeBank: PublicKey,
    vault: PublicKey,
    tokenAcc: PublicKey,
    quantity: number,
    accountNum: number,
    info?: string,
    referrerPk?: PublicKey,
    payerPk?: PublicKey,
  ): Promise<[string, TransactionSignature] | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const transaction = new Transaction();
    const payer = payerPk ?? owner.publicKey;

    const accountNumBN = new BN(accountNum);
    const [mangoAccountPk] = await PublicKey.findProgramAddress(
      [
        mangoGroup.publicKey.toBytes(),
        owner.publicKey.toBytes(),
        accountNumBN.toArrayLike(Buffer, 'le', 8),
      ],
      this.programId,
    );

    const createMangoAccountInstruction = makeCreateMangoAccountInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccountPk,
      owner.publicKey,
      accountNumBN,
      payer,
    );

    transaction.add(createMangoAccountInstruction);

    if (referrerPk) {
      const [referrerMemoryPk] = await PublicKey.findProgramAddress(
        [mangoAccountPk.toBytes(), new Buffer('ReferrerMemory', 'utf-8')],
        this.programId,
      );

      const setReferrerInstruction = makeSetReferrerMemoryInstruction(
        this.programId,
        mangoGroup.publicKey,
        mangoAccountPk,
        owner.publicKey,
        referrerMemoryPk,
        referrerPk,
        owner.publicKey,
      );
      transaction.add(setReferrerInstruction);
    }

    const additionalSigners: Keypair[] = [];

    const tokenIndex = mangoGroup.getRootBankIndex(rootBank);
    const tokenMint = mangoGroup.tokens[tokenIndex].mint;

    let wrappedSolAccount: Keypair | null = null;
    if (
      tokenMint.equals(WRAPPED_SOL_MINT) &&
      tokenAcc.toBase58() === owner.publicKey.toBase58()
    ) {
      wrappedSolAccount = new Keypair();
      const lamports = Math.round(quantity * LAMPORTS_PER_SOL) + 1e7;
      transaction.add(
        SystemProgram.createAccount({
          fromPubkey: owner.publicKey,
          newAccountPubkey: wrappedSolAccount.publicKey,
          lamports,
          space: 165,
          programId: TOKEN_PROGRAM_ID,
        }),
      );

      transaction.add(
        initializeAccount({
          account: wrappedSolAccount.publicKey,
          mint: WRAPPED_SOL_MINT,
          owner: owner.publicKey,
        }),
      );

      additionalSigners.push(wrappedSolAccount);
    }

    const nativeQuantity = uiToNative(
      quantity,
      mangoGroup.tokens[tokenIndex].decimals,
    );

    const instruction = makeDepositInstruction(
      this.programId,
      mangoGroup.publicKey,
      owner.publicKey,
      mangoGroup.mangoCache,
      mangoAccountPk,
      rootBank,
      nodeBank,
      vault,
      wrappedSolAccount?.publicKey ?? tokenAcc,
      nativeQuantity,
    );
    transaction.add(instruction);

    if (info) {
      const addAccountNameinstruction = makeAddMangoAccountInfoInstruction(
        this.programId,
        mangoGroup.publicKey,
        mangoAccountPk,
        owner.publicKey,
        info,
      );
      transaction.add(addAccountNameinstruction);
    }

    if (wrappedSolAccount) {
      transaction.add(
        closeAccount({
          source: wrappedSolAccount.publicKey,
          destination: owner.publicKey,
          owner: owner.publicKey,
        }),
      );
    }

    const txid = await this.sendTransaction(
      transaction,
      owner,
      additionalSigners,
    );

    return [mangoAccountPk.toString(), txid];
  }

  /**
   * Deposit tokens in a Mango Account
   *
   * @param rootBank The RootBank for the deposit currency
   * @param nodeBank The NodeBank asociated with the RootBank
   * @param vault The token account asociated with the NodeBank
   * @param tokenAcc The token account to transfer from
   */
  async deposit(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Payer,
    rootBank: PublicKey,
    nodeBank: PublicKey,
    vault: PublicKey,
    tokenAcc: PublicKey,

    quantity: number,
  ): Promise<TransactionSignature | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const transaction = new Transaction();
    const additionalSigners: Array<Keypair> = [];
    const tokenIndex = mangoGroup.getRootBankIndex(rootBank);
    const tokenMint = mangoGroup.tokens[tokenIndex].mint;

    let wrappedSolAccount: Keypair | null = null;
    if (
      tokenMint.equals(WRAPPED_SOL_MINT) &&
      tokenAcc.toBase58() === owner.publicKey.toBase58()
    ) {
      wrappedSolAccount = new Keypair();
      const lamports = Math.round(quantity * LAMPORTS_PER_SOL) + 1e7;
      transaction.add(
        SystemProgram.createAccount({
          fromPubkey: owner.publicKey,
          newAccountPubkey: wrappedSolAccount.publicKey,
          lamports,
          space: 165,
          programId: TOKEN_PROGRAM_ID,
        }),
      );

      transaction.add(
        initializeAccount({
          account: wrappedSolAccount.publicKey,
          mint: WRAPPED_SOL_MINT,
          owner: owner.publicKey,
        }),
      );

      additionalSigners.push(wrappedSolAccount);
    }

    const nativeQuantity = uiToNative(
      quantity,
      mangoGroup.tokens[tokenIndex].decimals,
    );

    const instruction = makeDepositInstruction(
      this.programId,
      mangoGroup.publicKey,
      owner.publicKey,
      mangoGroup.mangoCache,
      mangoAccount.publicKey,
      rootBank,
      nodeBank,
      vault,
      wrappedSolAccount?.publicKey ?? tokenAcc,
      nativeQuantity,
    );

    transaction.add(instruction);

    if (wrappedSolAccount) {
      transaction.add(
        closeAccount({
          source: wrappedSolAccount.publicKey,
          destination: owner.publicKey,
          owner: owner.publicKey,
        }),
      );
    }

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  /**
   * Withdraw tokens from a Mango Account
   *
   * @param rootBank The RootBank for the withdrawn currency
   * @param nodeBank The NodeBank asociated with the RootBank
   * @param vault The token account asociated with the NodeBank
   * @param allowBorrow Whether to borrow tokens if there are not enough deposits for the withdrawal
   */
  async withdraw(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Payer,
    rootBank: PublicKey,
    nodeBank: PublicKey,
    vault: PublicKey,

    quantity: number,
    allowBorrow: boolean,
  ): Promise<TransactionSignature | undefined> {
    if (!owner.publicKey) {
      return;
    }

    const transaction = new Transaction();
    const additionalSigners: Keypair[] = [];
    const tokenIndex = mangoGroup.getRootBankIndex(rootBank);
    const tokenMint = mangoGroup.tokens[tokenIndex].mint;

    let tokenAcc = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      tokenMint,
      owner.publicKey,
    );

    let wrappedSolAccount: Keypair | null = null;
    if (tokenMint.equals(WRAPPED_SOL_MINT)) {
      wrappedSolAccount = new Keypair();
      tokenAcc = wrappedSolAccount.publicKey;
      const space = 165;
      const lamports = await this.connection.getMinimumBalanceForRentExemption(
        space,
        'processed',
      );
      transaction.add(
        SystemProgram.createAccount({
          fromPubkey: owner.publicKey,
          newAccountPubkey: tokenAcc,
          lamports,
          space,
          programId: TOKEN_PROGRAM_ID,
        }),
      );
      transaction.add(
        initializeAccount({
          account: tokenAcc,
          mint: WRAPPED_SOL_MINT,
          owner: owner.publicKey,
        }),
      );
      additionalSigners.push(wrappedSolAccount);
    } else {
      const tokenAccExists = await this.connection.getAccountInfo(tokenAcc);
      if (!tokenAccExists) {
        transaction.add(
          Token.createAssociatedTokenAccountInstruction(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            tokenMint,
            tokenAcc,
            owner.publicKey,
            owner.publicKey,
          ),
        );
      }
    }

    const nativeQuantity = uiToNative(
      quantity,
      mangoGroup.tokens[tokenIndex].decimals,
    );

    const instruction = makeWithdrawInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      owner.publicKey,
      mangoGroup.mangoCache,
      rootBank,
      nodeBank,
      vault,
      tokenAcc,
      mangoGroup.signerKey,
      mangoAccount.spotOpenOrders,
      nativeQuantity,
      allowBorrow,
    );
    transaction.add(instruction);

    if (wrappedSolAccount) {
      transaction.add(
        closeAccount({
          source: wrappedSolAccount.publicKey,
          destination: owner.publicKey,
          owner: owner.publicKey,
        }),
      );
    }

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async withdrawAll(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Payer,
  ) {
    if (!owner.publicKey) {
      return;
    }
    const transactionsAndSigners: {
      transaction: Transaction;
      signers: Keypair[];
    }[] = [];
    for (const rootBank of mangoGroup.rootBankAccounts) {
      const transactionAndSigners: {
        transaction: Transaction;
        signers: Keypair[];
      } = {
        transaction: new Transaction(),
        signers: [],
      };
      if (rootBank) {
        const tokenIndex = mangoGroup.getRootBankIndex(rootBank?.publicKey);
        const tokenMint = mangoGroup.tokens[tokenIndex].mint;
        // const decimals = mangoGroup.tokens[tokenIndex].decimals;
        if (mangoAccount.deposits[tokenIndex].isPos()) {
          let tokenAcc = await Token.getAssociatedTokenAddress(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            tokenMint,
            owner.publicKey,
          );

          let wrappedSolAccount: Keypair | null = null;
          if (tokenMint.equals(WRAPPED_SOL_MINT)) {
            wrappedSolAccount = new Keypair();
            tokenAcc = wrappedSolAccount.publicKey;
            const space = 165;
            const lamports =
              await this.connection.getMinimumBalanceForRentExemption(
                space,
                'processed',
              );
            transactionAndSigners.transaction.add(
              SystemProgram.createAccount({
                fromPubkey: owner.publicKey,
                newAccountPubkey: tokenAcc,
                lamports,
                space,
                programId: TOKEN_PROGRAM_ID,
              }),
            );
            transactionAndSigners.transaction.add(
              initializeAccount({
                account: tokenAcc,
                mint: WRAPPED_SOL_MINT,
                owner: owner.publicKey,
              }),
            );
            transactionAndSigners.signers.push(wrappedSolAccount);
          } else {
            const tokenAccExists = await this.connection.getAccountInfo(
              tokenAcc,
              'recent',
            );
            if (!tokenAccExists) {
              transactionAndSigners.transaction.add(
                Token.createAssociatedTokenAccountInstruction(
                  ASSOCIATED_TOKEN_PROGRAM_ID,
                  TOKEN_PROGRAM_ID,
                  tokenMint,
                  tokenAcc,
                  owner.publicKey,
                  owner.publicKey,
                ),
              );
            }
          }

          const instruction = makeWithdrawInstruction(
            this.programId,
            mangoGroup.publicKey,
            mangoAccount.publicKey,
            owner.publicKey,
            mangoGroup.mangoCache,
            rootBank.publicKey,
            rootBank.nodeBanks[0],
            rootBank.nodeBankAccounts[0].vault,
            tokenAcc,
            mangoGroup.signerKey,
            mangoAccount.spotOpenOrders,
            new BN('18446744073709551615'), // u64::MAX to withdraw errything
            false,
          );
          transactionAndSigners.transaction.add(instruction);

          if (wrappedSolAccount) {
            transactionAndSigners.transaction.add(
              closeAccount({
                source: wrappedSolAccount.publicKey,
                destination: owner.publicKey,
                owner: owner.publicKey,
              }),
            );
          }
        }
      }
      transactionsAndSigners.push(transactionAndSigners);
    }
    const currentBlockhash = await this.getCurrentBlockhash();
    const signedTransactions = await this.signTransactions({
      transactionsAndSigners,
      payer: owner,
      currentBlockhash,
    });

    if (signedTransactions) {
      for (const signedTransaction of signedTransactions) {
        if (signedTransaction.instructions.length == 0) {
          continue;
        }
        const txid = await this.sendSignedTransaction({
          signedTransaction,
          signedAtBlock: currentBlockhash,
        });
        console.log(txid);
      }
    } else {
      throw new Error('Unable to sign Settle All transaction');
    }
  }

  // Keeper functions
  /**
   * Called by the Keeper to cache interest rates from the RootBanks
   */
  async cacheRootBanks(
    mangoGroup: PublicKey,
    mangoCache: PublicKey,
    rootBanks: PublicKey[],
    payer: Payer,
  ): Promise<TransactionSignature> {
    const cacheRootBanksInstruction = makeCacheRootBankInstruction(
      this.programId,
      mangoGroup,
      mangoCache,
      rootBanks,
    );

    const transaction = new Transaction();
    transaction.add(cacheRootBanksInstruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  /**
   * Called by the Keeper to cache prices from the Oracles
   */
  async cachePrices(
    mangoGroup: PublicKey,
    mangoCache: PublicKey,
    oracles: PublicKey[],
    payer: Payer,
  ): Promise<TransactionSignature> {
    const cachePricesInstruction = makeCachePricesInstruction(
      this.programId,
      mangoGroup,
      mangoCache,
      oracles,
    );

    const transaction = new Transaction();
    transaction.add(cachePricesInstruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  /**
   * Called by the Keeper to cache perp market funding
   */
  async cachePerpMarkets(
    mangoGroup: PublicKey,
    mangoCache: PublicKey,
    perpMarkets: PublicKey[],
    payer: Keypair,
  ): Promise<TransactionSignature> {
    const cachePerpMarketsInstruction = makeCachePerpMarketsInstruction(
      this.programId,
      mangoGroup,
      mangoCache,
      perpMarkets,
    );

    const transaction = new Transaction();
    transaction.add(cachePerpMarketsInstruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  /**
   * Called by the Keeper to update interest rates on the RootBanks
   */
  async updateRootBank(
    mangoGroup: MangoGroup,
    rootBank: PublicKey,
    nodeBanks: PublicKey[],
    payer: Payer,
  ): Promise<TransactionSignature> {
    const updateRootBanksInstruction = makeUpdateRootBankInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      rootBank,
      nodeBanks,
    );

    const transaction = new Transaction();
    transaction.add(updateRootBanksInstruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  /**
   * Called by the Keeper to process events on the Perp order book
   */
  async consumeEvents(
    mangoGroup: MangoGroup,
    perpMarket: PerpMarket,
    mangoAccounts: PublicKey[],
    payer: Keypair,
    limit: BN,
  ): Promise<TransactionSignature> {
    const consumeEventsInstruction = makeConsumeEventsInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      perpMarket.publicKey,
      perpMarket.eventQueue,
      mangoAccounts,
      limit,
    );

    const transaction = new Transaction();
    transaction.add(consumeEventsInstruction);

    return await this.sendTransaction(transaction, payer, [], null);
  }

  /**
   * Called by the Keeper to update funding on the perp markets
   */
  async updateFunding(
    mangoGroup: PublicKey,
    mangoCache: PublicKey,
    perpMarket: PublicKey,
    bids: PublicKey,
    asks: PublicKey,
    payer: Keypair,
  ): Promise<TransactionSignature> {
    const updateFundingInstruction = makeUpdateFundingInstruction(
      this.programId,
      mangoGroup,
      mangoCache,
      perpMarket,
      bids,
      asks,
    );

    const transaction = new Transaction();
    transaction.add(updateFundingInstruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  /**
   * Retrieve information about a perp market
   */
  async getPerpMarket(
    perpMarketPk: PublicKey,
    baseDecimal: number,
    quoteDecimal: number,
  ): Promise<PerpMarket> {
    const acc = await this.connection.getAccountInfo(perpMarketPk);
    const perpMarket = new PerpMarket(
      perpMarketPk,
      baseDecimal,
      quoteDecimal,
      PerpMarketLayout.decode(acc?.data),
    );
    return perpMarket;
  }

  /**
   * Place an order on a perp market
   *
   * @param clientOrderId An optional id that can be used to correlate events related to your order
   * @param bookSideInfo Account info for asks if side === bid, bids if side === ask. If this is given, crank instruction is added
   */
  async placePerpOrder(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    mangoCache: PublicKey, // TODO - remove; already in MangoGroup
    perpMarket: PerpMarket,
    owner: Payer,
    side: 'buy' | 'sell',
    price: number,
    quantity: number,
    orderType?: PerpOrderType,
    clientOrderId = 0,
    bookSideInfo?: AccountInfo<Buffer>,
    reduceOnly?: boolean,
    referrerMangoAccountPk?: PublicKey,
  ): Promise<TransactionSignature | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const [nativePrice, nativeQuantity] = perpMarket.uiToNativePriceQuantity(
      price,
      quantity,
    );
    const transaction = new Transaction();
    const additionalSigners: Keypair[] = [];

    const instruction = makePlacePerpOrderInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      owner.publicKey,
      mangoCache,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      perpMarket.eventQueue,
      mangoAccount.spotOpenOrders,
      nativePrice,
      nativeQuantity,
      new BN(clientOrderId),
      side,
      orderType,
      reduceOnly,
      referrerMangoAccountPk,
    );
    transaction.add(instruction);

    if (bookSideInfo) {
      // If this data is already parsed as BookSide, use that instead of decoding again
      let bookSide = bookSideInfo['parsed'];
      if (bookSide === undefined) {
        bookSide = bookSideInfo.data
          ? new BookSide(
              side === 'buy' ? perpMarket.asks : perpMarket.bids,
              perpMarket,
              BookSideLayout.decode(bookSideInfo.data),
            )
          : [];
      }
      const accounts: Set<string> = new Set();
      accounts.add(mangoAccount.publicKey.toBase58());

      for (const order of bookSide) {
        accounts.add(order.owner.toBase58());
        if (accounts.size >= 10) {
          break;
        }
      }

      const consumeInstruction = makeConsumeEventsInstruction(
        this.programId,
        mangoGroup.publicKey,
        mangoGroup.mangoCache,
        perpMarket.publicKey,
        perpMarket.eventQueue,
        Array.from(accounts)
          .map((s) => new PublicKey(s))
          .sort(),
        new BN(4),
      );
      transaction.add(consumeInstruction);
    }

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  /**
   * Place an order on a perp market
   *
   * @param clientOrderId An optional id that can be used to correlate events related to your order
   * @param bookSideInfo Account info for asks if side === bid, bids if side === ask. If this is given, crank instruction is added
   */
  async placePerpOrder2(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    perpMarket: PerpMarket,
    owner: Payer,

    side: 'buy' | 'sell',
    price: number,
    quantity: number,

    options?: {
      maxQuoteQuantity?: number;
      limit?: number;
      orderType?: PerpOrderType;
      clientOrderId?: number;
      bookSideInfo?: AccountInfo<Buffer>;
      reduceOnly?: boolean;
      referrerMangoAccountPk?: PublicKey;
      expiryTimestamp?: number;
    },
  ): Promise<TransactionSignature | undefined> {
    if (!owner.publicKey) {
      return;
    }
    options = options ? options : {};
    let {
      maxQuoteQuantity,
      limit,
      orderType,
      clientOrderId,
      bookSideInfo,
      reduceOnly,
      referrerMangoAccountPk,
      expiryTimestamp,
    } = options;
    limit = limit || 20;
    clientOrderId = clientOrderId === undefined ? 0 : clientOrderId;
    orderType = orderType || 'limit';

    const [nativePrice, nativeQuantity] = perpMarket.uiToNativePriceQuantity(
      price,
      quantity,
    );
    const maxQuoteQuantityLots = maxQuoteQuantity
      ? perpMarket.uiQuoteToLots(maxQuoteQuantity)
      : I64_MAX_BN;

    const transaction = new Transaction();
    const additionalSigners: Keypair[] = [];

    const instruction = makePlacePerpOrder2Instruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      owner.publicKey,
      mangoGroup.mangoCache,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      perpMarket.eventQueue,
      mangoAccount.getOpenOrdersKeysInBasketPacked(),
      nativePrice,
      nativeQuantity,
      maxQuoteQuantityLots,
      new BN(clientOrderId),
      side,
      new BN(limit),
      orderType,
      reduceOnly,
      referrerMangoAccountPk,
      expiryTimestamp ? new BN(Math.floor(expiryTimestamp)) : ZERO_BN,
    );
    transaction.add(instruction);

    if (bookSideInfo) {
      // If this data is already parsed as BookSide, use that instead of decoding again
      let bookSide = bookSideInfo['parsed'];
      if (bookSide === undefined) {
        bookSide = bookSideInfo.data
          ? new BookSide(
              side === 'buy' ? perpMarket.asks : perpMarket.bids,
              perpMarket,
              BookSideLayout.decode(bookSideInfo.data),
            )
          : [];
      }
      const accounts: Set<string> = new Set();
      accounts.add(mangoAccount.publicKey.toBase58());

      for (const order of bookSide) {
        accounts.add(order.owner.toBase58());
        if (accounts.size >= 10) {
          break;
        }
      }

      const consumeInstruction = makeConsumeEventsInstruction(
        this.programId,
        mangoGroup.publicKey,
        mangoGroup.mangoCache,
        perpMarket.publicKey,
        perpMarket.eventQueue,
        Array.from(accounts)
          .map((s) => new PublicKey(s))
          .sort(),
        new BN(4),
      );
      transaction.add(consumeInstruction);
    }

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  /**
   * Cancel an order on a perp market
   *
   * @param invalidIdOk Don't throw error if order is invalid
   */
  async cancelPerpOrder(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Payer,
    perpMarket: PerpMarket,
    order: PerpOrder,
    invalidIdOk = false,
  ): Promise<TransactionSignature | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const instruction = makeCancelPerpOrderInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      owner.publicKey,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      order,
      invalidIdOk,
    );

    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  /**
   * Cancel all perp orders across all markets
   */
  async cancelAllPerpOrders(
    group: MangoGroup,
    perpMarkets: PerpMarket[],
    mangoAccount: MangoAccount,
    owner: Payer,
  ): Promise<TransactionSignature[] | undefined> {
    if (!owner.publicKey) {
      return;
    }
    let tx = new Transaction();
    const transactions: Transaction[] = [];

    // Determine which market indexes have open orders
    const hasOrders = new Array(group.perpMarkets.length).fill(false);
    for (let i = 0; i < mangoAccount.orderMarket.length; i++) {
      if (mangoAccount.orderMarket[i] !== FREE_ORDER_SLOT) {
        hasOrders[mangoAccount.orderMarket[i]] = true;
      }
    }

    for (let i = 0; i < group.perpMarkets.length; i++) {
      if (!hasOrders[i]) continue;

      const pmi = group.perpMarkets[i];
      if (pmi.isEmpty()) continue;
      const perpMarket = perpMarkets.find((pm) =>
        pm.publicKey.equals(pmi.perpMarket),
      );
      if (perpMarket === undefined) continue;

      const cancelAllInstr = makeCancelAllPerpOrdersInstruction(
        this.programId,
        group.publicKey,
        mangoAccount.publicKey,
        owner.publicKey,
        perpMarket.publicKey,
        perpMarket.bids,
        perpMarket.asks,
        new BN(20),
      );
      tx.add(cancelAllInstr);
      if (tx.instructions.length === 2) {
        transactions.push(tx);
        tx = new Transaction();
      }
    }
    if (tx.instructions.length > 0) {
      transactions.push(tx);
    }

    const transactionsAndSigners = transactions.map((tx) => ({
      transaction: tx,
      signers: [],
    }));

    if (transactionsAndSigners.length === 0) {
      throw new Error('No orders to cancel');
    }

    // Sign multiple transactions at once for better UX
    const currentBlockhash = await this.getCurrentBlockhash();
    const signedTransactions = await this.signTransactions({
      transactionsAndSigners,
      payer: owner,
      currentBlockhash,
    });
    if (signedTransactions) {
      return await Promise.all(
        signedTransactions.map((signedTransaction) =>
          this.sendSignedTransaction({
            signedTransaction,
            signedAtBlock: currentBlockhash,
          }),
        ),
      );
    } else {
      throw new Error('Unable to sign all CancelAllPerpOrders transactions');
    }
  }

  /**
   * Add a new oracle to a group
   */
  async addOracle(
    mangoGroup: MangoGroup,
    oracle: PublicKey,
    admin: Keypair,
  ): Promise<TransactionSignature> {
    const instruction = makeAddOracleInstruction(
      this.programId,
      mangoGroup.publicKey,
      oracle,
      admin.publicKey,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    const additionalSigners = [];
    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  /**
   * Set the price of a 'stub' type oracle
   */
  async setOracle(
    mangoGroup: MangoGroup,
    oracle: PublicKey,
    admin: Keypair,
    price: I80F48,
  ): Promise<TransactionSignature> {
    const instruction = makeSetOracleInstruction(
      this.programId,
      mangoGroup.publicKey,
      oracle,
      admin.publicKey,
      price,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    const additionalSigners = [];
    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  async addSpotMarket(
    mangoGroup: MangoGroup,
    oracle: PublicKey,
    spotMarket: PublicKey,
    mint: PublicKey,
    admin: Keypair,

    maintLeverage: number,
    initLeverage: number,
    liquidationFee: number,
    optimalUtil: number,
    optimalRate: number,
    maxRate: number,
  ): Promise<TransactionSignature> {
    const vaultAccount = new Keypair();

    const vaultAccountInstructions = await createTokenAccountInstructions(
      this.connection,
      admin.publicKey,
      vaultAccount.publicKey,
      mint,
      mangoGroup.signerKey,
    );

    const nodeBankAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      NodeBankLayout.span,
      this.programId,
    );
    const rootBankAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      RootBankLayout.span,
      this.programId,
    );

    const instruction = makeAddSpotMarketInstruction(
      this.programId,
      mangoGroup.publicKey,
      oracle,
      spotMarket,
      mangoGroup.dexProgramId,
      mint,
      nodeBankAccountInstruction.account.publicKey,
      vaultAccount.publicKey,
      rootBankAccountInstruction.account.publicKey,
      admin.publicKey,
      I80F48.fromNumber(maintLeverage),
      I80F48.fromNumber(initLeverage),
      I80F48.fromNumber(liquidationFee),
      I80F48.fromNumber(optimalUtil),
      I80F48.fromNumber(optimalRate),
      I80F48.fromNumber(maxRate),
    );
    const transaction = new Transaction();
    transaction.add(...vaultAccountInstructions);
    transaction.add(nodeBankAccountInstruction.instruction);
    transaction.add(rootBankAccountInstruction.instruction);
    transaction.add(instruction);

    const additionalSigners = [
      vaultAccount,
      nodeBankAccountInstruction.account,
      rootBankAccountInstruction.account,
    ];
    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  /**
   * Make sure mangoAccount has recent and valid inMarginBasket and spotOpenOrders
   */
  async placeSpotOrder(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    mangoCache: PublicKey,
    spotMarket: Market,
    owner: Payer,

    side: 'buy' | 'sell',
    price: number,
    size: number,
    orderType?: 'limit' | 'ioc' | 'postOnly',
    clientId?: BN,
  ): Promise<TransactionSignature | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const limitPrice = spotMarket.priceNumberToLots(price);
    const maxBaseQuantity = spotMarket.baseSizeNumberToLots(size);

    // TODO implement srm vault fee discount
    // const feeTier = getFeeTier(0, nativeToUi(mangoGroup.nativeSrm || 0, SRM_DECIMALS));
    const feeTier = getFeeTier(0, nativeToUi(0, 0));
    const rates = getFeeRates(feeTier);
    const maxQuoteQuantity = new BN(
      spotMarket['_decoded'].quoteLotSize.toNumber() * (1 + rates.taker),
    ).mul(
      spotMarket
        .baseSizeNumberToLots(size)
        .mul(spotMarket.priceNumberToLots(price)),
    );

    if (maxBaseQuantity.lte(ZERO_BN)) {
      throw new Error('size too small');
    }
    if (limitPrice.lte(ZERO_BN)) {
      throw new Error('invalid price');
    }
    const selfTradeBehavior = 'decrementTake';
    clientId = clientId ?? new BN(Date.now());

    const spotMarketIndex = mangoGroup.getSpotMarketIndex(spotMarket.publicKey);

    if (!mangoGroup.rootBankAccounts.filter((a) => !!a).length) {
      await mangoGroup.loadRootBanks(this.connection);
    }

    const baseRootBank = mangoGroup.rootBankAccounts[spotMarketIndex];
    const baseNodeBank = baseRootBank?.nodeBankAccounts[0];
    const quoteRootBank = mangoGroup.rootBankAccounts[QUOTE_INDEX];
    const quoteNodeBank = quoteRootBank?.nodeBankAccounts[0];

    if (!baseRootBank || !baseNodeBank || !quoteRootBank || !quoteNodeBank) {
      throw new Error('Invalid or missing banks');
    }

    const transaction = new Transaction();
    const additionalSigners: Keypair[] = [];
    const openOrdersKeys: { pubkey: PublicKey; isWritable: boolean }[] = [];

    // Only pass in open orders if in margin basket or current market index, and
    // the only writable account should be OpenOrders for current market index
    for (let i = 0; i < mangoAccount.spotOpenOrders.length; i++) {
      let pubkey = zeroKey;
      let isWritable = false;

      if (i === spotMarketIndex) {
        isWritable = true;

        if (mangoAccount.spotOpenOrders[spotMarketIndex].equals(zeroKey)) {
          // open orders missing for this market; create a new one now
          const openOrdersSpace = OpenOrders.getLayout(
            mangoGroup.dexProgramId,
          ).span;

          const openOrdersLamports =
            await this.connection.getMinimumBalanceForRentExemption(
              openOrdersSpace,
              'processed',
            );

          const accInstr = await createAccountInstruction(
            this.connection,
            owner.publicKey,
            openOrdersSpace,
            mangoGroup.dexProgramId,
            openOrdersLamports,
          );

          const initOpenOrders = makeInitSpotOpenOrdersInstruction(
            this.programId,
            mangoGroup.publicKey,
            mangoAccount.publicKey,
            owner.publicKey,
            mangoGroup.dexProgramId,
            accInstr.account.publicKey,
            spotMarket.publicKey,
            mangoGroup.signerKey,
          );

          const initTx = new Transaction();

          initTx.add(accInstr.instruction);
          initTx.add(initOpenOrders);

          await this.sendTransaction(initTx, owner, [accInstr.account]);

          pubkey = accInstr.account.publicKey;
        } else {
          pubkey = mangoAccount.spotOpenOrders[i];
        }
      } else if (mangoAccount.inMarginBasket[i]) {
        pubkey = mangoAccount.spotOpenOrders[i];
      }

      openOrdersKeys.push({ pubkey, isWritable });
    }

    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId,
    );

    const placeOrderInstruction = makePlaceSpotOrderInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      owner.publicKey,
      mangoCache,
      spotMarket.programId,
      spotMarket.publicKey,
      spotMarket['_decoded'].bids,
      spotMarket['_decoded'].asks,
      spotMarket['_decoded'].requestQueue,
      spotMarket['_decoded'].eventQueue,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      baseRootBank.publicKey,
      baseNodeBank.publicKey,
      baseNodeBank.vault,
      quoteRootBank.publicKey,
      quoteNodeBank.publicKey,
      quoteNodeBank.vault,
      mangoGroup.signerKey,
      dexSigner,
      mangoGroup.srmVault, // TODO: choose msrm vault if it has any deposits
      openOrdersKeys,
      side,
      limitPrice,
      maxBaseQuantity,
      maxQuoteQuantity,
      selfTradeBehavior,
      orderType,
      clientId,
    );
    transaction.add(placeOrderInstruction);

    if (spotMarketIndex > 0) {
      console.log(
        spotMarketIndex - 1,
        mangoAccount.spotOpenOrders[spotMarketIndex - 1].toBase58(),
        openOrdersKeys[spotMarketIndex - 1].pubkey.toBase58(),
      );
    }

    const txid = await this.sendTransaction(
      transaction,
      owner,
      additionalSigners,
    );

    // update MangoAccount to have new OpenOrders pubkey
    mangoAccount.spotOpenOrders[spotMarketIndex] =
      openOrdersKeys[spotMarketIndex].pubkey;
    mangoAccount.inMarginBasket[spotMarketIndex] = true;
    console.log(
      spotMarketIndex,
      mangoAccount.spotOpenOrders[spotMarketIndex].toBase58(),
      openOrdersKeys[spotMarketIndex].pubkey.toBase58(),
    );

    return txid;
  }

  /**
   * Make sure mangoAccount has recent and valid inMarginBasket and spotOpenOrders
   */
  async placeSpotOrder2(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    spotMarket: Market,
    owner: Payer,

    side: 'buy' | 'sell',
    price: number,
    size: number,
    orderType?: 'limit' | 'ioc' | 'postOnly',
    clientOrderId?: BN,
    useMsrmVault?: boolean | undefined,
  ): Promise<TransactionSignature[] | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const limitPrice = spotMarket.priceNumberToLots(price);
    const maxBaseQuantity = spotMarket.baseSizeNumberToLots(size);
    const allTransactions: Transaction[] = [];

    // TODO implement srm vault fee discount
    // const feeTier = getFeeTier(0, nativeToUi(mangoGroup.nativeSrm || 0, SRM_DECIMALS));
    const feeTier = getFeeTier(0, nativeToUi(0, 0));
    const rates = getFeeRates(feeTier);
    const maxQuoteQuantity = new BN(
      spotMarket['_decoded'].quoteLotSize.toNumber() * (1 + rates.taker),
    ).mul(
      spotMarket
        .baseSizeNumberToLots(size)
        .mul(spotMarket.priceNumberToLots(price)),
    );

    if (maxBaseQuantity.lte(ZERO_BN)) {
      throw new Error('size too small');
    }
    if (limitPrice.lte(ZERO_BN)) {
      throw new Error('invalid price');
    }
    const selfTradeBehavior = 'decrementTake';

    const spotMarketIndex = mangoGroup.getSpotMarketIndex(spotMarket.publicKey);

    if (!mangoGroup.rootBankAccounts.filter((a) => !!a).length) {
      await mangoGroup.loadRootBanks(this.connection);
    }
    let feeVault: PublicKey;
    if (useMsrmVault) {
      feeVault = mangoGroup.msrmVault;
    } else if (useMsrmVault === false) {
      feeVault = mangoGroup.srmVault;
    } else {
      const totalMsrm = await this.connection.getTokenAccountBalance(
        mangoGroup.msrmVault,
      );
      feeVault =
        totalMsrm?.value?.uiAmount && totalMsrm.value.uiAmount > 0
          ? mangoGroup.msrmVault
          : mangoGroup.srmVault;
    }

    const baseRootBank = mangoGroup.rootBankAccounts[spotMarketIndex];
    const baseNodeBank = baseRootBank?.nodeBankAccounts[0];
    const quoteRootBank = mangoGroup.rootBankAccounts[QUOTE_INDEX];
    const quoteNodeBank = quoteRootBank?.nodeBankAccounts[0];

    if (!baseRootBank || !baseNodeBank || !quoteRootBank || !quoteNodeBank) {
      throw new Error('Invalid or missing banks');
    }

    const transaction = new Transaction();
    const openOrdersKeys: { pubkey: PublicKey; isWritable: boolean }[] = [];

    // Only pass in open orders if in margin basket or current market index, and
    // the only writable account should be OpenOrders for current market index
    let marketOpenOrdersKey = zeroKey;
    const initTx = new Transaction();
    for (let i = 0; i < mangoAccount.spotOpenOrders.length; i++) {
      let pubkey = zeroKey;
      let isWritable = false;

      if (i === spotMarketIndex) {
        isWritable = true;

        if (mangoAccount.spotOpenOrders[spotMarketIndex].equals(zeroKey)) {
          const spotMarketIndexBN = new BN(spotMarketIndex);
          const [openOrdersPk] = await PublicKey.findProgramAddress(
            [
              mangoAccount.publicKey.toBytes(),
              spotMarketIndexBN.toArrayLike(Buffer, 'le', 8),
              new Buffer('OpenOrders', 'utf-8'),
            ],
            this.programId,
          );

          const initOpenOrders = makeCreateSpotOpenOrdersInstruction(
            this.programId,
            mangoGroup.publicKey,
            mangoAccount.publicKey,
            owner.publicKey,
            mangoGroup.dexProgramId,
            openOrdersPk,
            spotMarket.publicKey,
            mangoGroup.signerKey,
          );

          initTx.add(initOpenOrders);
          allTransactions.push(initTx);

          pubkey = openOrdersPk;
        } else {
          pubkey = mangoAccount.spotOpenOrders[i];
        }
        marketOpenOrdersKey = pubkey;
      } else if (mangoAccount.inMarginBasket[i]) {
        pubkey = mangoAccount.spotOpenOrders[i];
      }

      // new design does not require zero keys to be passed in
      if (!pubkey.equals(zeroKey)) {
        openOrdersKeys.push({ pubkey, isWritable });
      }
    }

    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId,
    );

    const placeOrderInstruction = makePlaceSpotOrder2Instruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      owner.publicKey,
      mangoGroup.mangoCache,
      spotMarket.programId,
      spotMarket.publicKey,
      spotMarket['_decoded'].bids,
      spotMarket['_decoded'].asks,
      spotMarket['_decoded'].requestQueue,
      spotMarket['_decoded'].eventQueue,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      baseRootBank.publicKey,
      baseNodeBank.publicKey,
      baseNodeBank.vault,
      quoteRootBank.publicKey,
      quoteNodeBank.publicKey,
      quoteNodeBank.vault,
      mangoGroup.signerKey,
      dexSigner,
      feeVault,
      openOrdersKeys,
      side,
      limitPrice,
      maxBaseQuantity,
      maxQuoteQuantity,
      selfTradeBehavior,
      orderType,
      clientOrderId ?? new BN(Date.now()),
    );
    transaction.add(placeOrderInstruction);
    allTransactions.push(transaction);

    const signers = [];
    const transactionsAndSigners = allTransactions.map((tx) => ({
      transaction: tx,
      signers,
    }));

    const currentBlockhash = await this.getCurrentBlockhash();
    const signedTransactions = await this.signTransactions({
      transactionsAndSigners,
      payer: owner,
      currentBlockhash,
    });

    const txids: TransactionSignature[] = [];

    if (signedTransactions) {
      for (const signedTransaction of signedTransactions) {
        if (signedTransaction.instructions.length == 0) {
          continue;
        }
        const txid = await this.sendSignedTransaction({
          signedTransaction,
          signedAtBlock: currentBlockhash,
        });
        txids.push(txid);
      }

      // update MangoAccount to have new OpenOrders pubkey
      // We know this new key is in margin basket because if it was a full taker trade
      // there is some leftover from fee rebate. If maker trade there's the order.
      // and if it failed then we already exited before this line
      mangoAccount.spotOpenOrders[spotMarketIndex] = marketOpenOrdersKey;
      mangoAccount.inMarginBasket[spotMarketIndex] = true;
    } else {
      throw new Error('Unable to sign Settle All transaction');
    }

    return txids;
  }

  async cancelSpotOrder(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Payer,
    spotMarket: Market,
    order: Order,
  ): Promise<TransactionSignature | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const transaction = new Transaction();
    const instruction = makeCancelSpotOrderInstruction(
      this.programId,
      mangoGroup.publicKey,
      owner.publicKey,
      mangoAccount.publicKey,
      spotMarket.programId,
      spotMarket.publicKey,
      spotMarket['_decoded'].bids,
      spotMarket['_decoded'].asks,
      order.openOrdersAddress,
      mangoGroup.signerKey,
      spotMarket['_decoded'].eventQueue,
      order,
    );
    transaction.add(instruction);

    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId,
    );

    const marketIndex = mangoGroup.getSpotMarketIndex(spotMarket.publicKey);
    if (!mangoGroup.rootBankAccounts.length) {
      await mangoGroup.loadRootBanks(this.connection);
    }
    const baseRootBank = mangoGroup.rootBankAccounts[marketIndex];
    const quoteRootBank = mangoGroup.rootBankAccounts[QUOTE_INDEX];
    const baseNodeBank = baseRootBank?.nodeBankAccounts[0];
    const quoteNodeBank = quoteRootBank?.nodeBankAccounts[0];

    if (!baseNodeBank || !quoteNodeBank) {
      throw new Error('Invalid or missing node banks');
    }
    const settleFundsInstruction = makeSettleFundsInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      owner.publicKey,
      mangoAccount.publicKey,
      spotMarket.programId,
      spotMarket.publicKey,
      mangoAccount.spotOpenOrders[marketIndex],
      mangoGroup.signerKey,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      mangoGroup.tokens[marketIndex].rootBank,
      baseNodeBank.publicKey,
      mangoGroup.tokens[QUOTE_INDEX].rootBank,
      quoteNodeBank.publicKey,
      baseNodeBank.vault,
      quoteNodeBank.vault,
      dexSigner,
    );
    transaction.add(settleFundsInstruction);

    const additionalSigners = [];

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async settleFunds(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Payer,
    spotMarket: Market,
  ): Promise<TransactionSignature | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const marketIndex = mangoGroup.getSpotMarketIndex(spotMarket.publicKey);
    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId,
    );

    if (!mangoGroup.rootBankAccounts.length) {
      await mangoGroup.loadRootBanks(this.connection);
    }
    const baseRootBank = mangoGroup.rootBankAccounts[marketIndex];
    const quoteRootBank = mangoGroup.rootBankAccounts[QUOTE_INDEX];
    const baseNodeBank = baseRootBank?.nodeBankAccounts[0];
    const quoteNodeBank = quoteRootBank?.nodeBankAccounts[0];

    if (!baseNodeBank || !quoteNodeBank) {
      throw new Error('Invalid or missing node banks');
    }

    const instruction = makeSettleFundsInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      owner.publicKey,
      mangoAccount.publicKey,
      spotMarket.programId,
      spotMarket.publicKey,
      mangoAccount.spotOpenOrders[marketIndex],
      mangoGroup.signerKey,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      mangoGroup.tokens[marketIndex].rootBank,
      baseNodeBank.publicKey,
      mangoGroup.tokens[QUOTE_INDEX].rootBank,
      quoteNodeBank.publicKey,
      baseNodeBank.vault,
      quoteNodeBank.vault,
      dexSigner,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    const additionalSigners = [];
    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  /**
   * Assumes spotMarkets contains all Markets in MangoGroup in order
   */
  async settleAll(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    spotMarkets: Market[],
    owner: Payer,
  ): Promise<TransactionSignature[] | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const transactions: Transaction[] = [];

    let j = 0;
    for (let i = 0; i < mangoGroup.spotMarkets.length; i++) {
      if (mangoGroup.spotMarkets[i].isEmpty()) continue;
      const spotMarket = spotMarkets[j];
      j++;

      const transaction = new Transaction();
      const openOrdersAccount = mangoAccount.spotOpenOrdersAccounts[i];
      if (openOrdersAccount === undefined) continue;

      if (
        openOrdersAccount.quoteTokenFree.toNumber() +
          openOrdersAccount['referrerRebatesAccrued'].toNumber() ===
          0 &&
        openOrdersAccount.baseTokenFree.toNumber() === 0
      ) {
        continue;
      }

      const dexSigner = await PublicKey.createProgramAddress(
        [
          spotMarket.publicKey.toBuffer(),
          spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
        ],
        spotMarket.programId,
      );

      if (!mangoGroup.rootBankAccounts.length) {
        await mangoGroup.loadRootBanks(this.connection);
      }
      const baseRootBank = mangoGroup.rootBankAccounts[i];
      const quoteRootBank = mangoGroup.rootBankAccounts[QUOTE_INDEX];
      const baseNodeBank = baseRootBank?.nodeBankAccounts[0];
      const quoteNodeBank = quoteRootBank?.nodeBankAccounts[0];

      if (!baseNodeBank || !quoteNodeBank) {
        throw new Error('Invalid or missing node banks');
      }

      const instruction = makeSettleFundsInstruction(
        this.programId,
        mangoGroup.publicKey,
        mangoGroup.mangoCache,
        owner.publicKey,
        mangoAccount.publicKey,
        spotMarket.programId,
        spotMarket.publicKey,
        mangoAccount.spotOpenOrders[i],
        mangoGroup.signerKey,
        spotMarket['_decoded'].baseVault,
        spotMarket['_decoded'].quoteVault,
        mangoGroup.tokens[i].rootBank,
        baseNodeBank.publicKey,
        mangoGroup.tokens[QUOTE_INDEX].rootBank,
        quoteNodeBank.publicKey,
        baseNodeBank.vault,
        quoteNodeBank.vault,
        dexSigner,
      );

      transaction.add(instruction);
      transactions.push(transaction);
    }

    const signers = [];
    const transactionsAndSigners = transactions.map((tx) => ({
      transaction: tx,
      signers,
    }));
    const currentBlockhash = await this.getCurrentBlockhash();
    const signedTransactions = await this.signTransactions({
      transactionsAndSigners,
      payer: owner,
      currentBlockhash,
    });

    const txids: TransactionSignature[] = [];

    if (signedTransactions) {
      for (const signedTransaction of signedTransactions) {
        if (signedTransaction.instructions.length == 0) {
          continue;
        }
        const txid = await this.sendSignedTransaction({
          signedTransaction,
          signedAtBlock: currentBlockhash,
        });
        txids.push(txid);
      }
    } else {
      throw new Error('Unable to sign Settle All transaction');
    }

    return txids;
  }

  async fetchTopPnlAccountsFromRPC(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    perpMarket: PerpMarket,
    price: I80F48, // should be the MangoCache price
    sign: number,
    mangoAccounts?: MangoAccount[],
  ): Promise<AccountWithPnl[]> {
    const marketIndex = mangoGroup.getPerpMarketIndex(perpMarket.publicKey);
    const perpMarketInfo = mangoGroup.perpMarkets[marketIndex];

    if (mangoAccounts === undefined) {
      mangoAccounts = await this.getAllMangoAccounts(mangoGroup, [], false);
    }

    return mangoAccounts
      .map((m) => ({
        publicKey: m.publicKey,
        pnl: m.perpAccounts[marketIndex].getPnl(
          perpMarketInfo,
          mangoCache.perpMarketCache[marketIndex],
          price,
        ),
      }))
      .sort((a, b) => sign * a.pnl.cmp(b.pnl));
  }

  async fetchTopPnlAccountsFromDB(
    mangoGroup: MangoGroup,
    perpMarket: PerpMarket,
    sign: number,
  ): Promise<AccountWithPnl[]> {
    const marketIndex = mangoGroup.getPerpMarketIndex(perpMarket.publicKey);
    const order = sign === 1 ? 'ASC' : 'DESC';

    const response = await fetch(
      `https://mango-transaction-log.herokuapp.com/v3/stats/ranked-pnl?market-index=${marketIndex}&order=${order}&limit=20`,
    );
    const data = await response.json();

    return data.map((m) => ({
      publicKey: new PublicKey(m.pubkey),
      pnl: I80F48.fromNumber(m.pnl),
    }));
  }

  /**
   * Automatically fetch MangoAccounts for this PerpMarket
   * Pick enough MangoAccounts that have opposite sign and send them in to get settled
   */
  async settlePnl(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    mangoAccount: MangoAccount,
    perpMarket: PerpMarket,
    quoteRootBank: RootBank,
    price: I80F48, // should be the MangoCache price
    owner: Payer,
    mangoAccounts?: MangoAccount[],
  ): Promise<TransactionSignature | null> {
    // fetch all MangoAccounts filtered for having this perp market in basket
    const marketIndex = mangoGroup.getPerpMarketIndex(perpMarket.publicKey);
    const perpMarketInfo = mangoGroup.perpMarkets[marketIndex];
    let pnl = mangoAccount.perpAccounts[marketIndex].getPnl(
      perpMarketInfo,
      mangoCache.perpMarketCache[marketIndex],
      price,
    );
    const transaction = new Transaction();
    const additionalSigners: Keypair[] = [];

    let sign;
    if (pnl.eq(ZERO_I80F48)) {
      // Can't settle pnl if there is no pnl
      return null;
    } else if (pnl.gt(ZERO_I80F48)) {
      sign = 1;
    } else {
      // Can settle fees first against perpmarket

      sign = -1;
      if (!quoteRootBank.nodeBankAccounts) {
        await quoteRootBank.loadNodeBanks(this.connection);
      }
      const settleFeesInstr = makeSettleFeesInstruction(
        this.programId,
        mangoGroup.publicKey,
        mangoCache.publicKey,
        perpMarket.publicKey,
        mangoAccount.publicKey,
        quoteRootBank.publicKey,
        quoteRootBank.nodeBanks[0],
        quoteRootBank.nodeBankAccounts[0].vault,
        mangoGroup.feesVault,
        mangoGroup.signerKey,
      );
      transaction.add(settleFeesInstr);
      pnl = pnl.add(perpMarket.feesAccrued).min(I80F48.fromString('-0.000001'));
      const remSign = pnl.gt(ZERO_I80F48) ? 1 : -1;
      if (remSign !== sign) {
        // if pnl has changed sign, then we're done
        return await this.sendTransaction(
          transaction,
          owner,
          additionalSigners,
        );
      }
    }

    // we don't maintain an off chain service for finding accounts for
    // devnet, so use fetchTopPnlAccountsFromDB only for mainnet
    let accountsWithPnl;
    // note: simplistic way of checking if we are on mainnet
    const isMainnet =
      (this.connection as any)['_rpcEndpoint'] &&
      !(this.connection as any)['_rpcEndpoint']
        .toLowerCase()
        // usually devnet rpc endpoints have devnet in them, mainnet ones don't
        .includes('devnet');
    if (isMainnet) {
      try {
        accountsWithPnl = await this.fetchTopPnlAccountsFromDB(
          mangoGroup,
          perpMarket,
          sign,
        );
      } catch (e) {
        console.error(`fetchTopPnlAccountsFromDB failed, ${e}`);
      }
    }
    // if not set, then always fallback
    if (!accountsWithPnl) {
      accountsWithPnl = await this.fetchTopPnlAccountsFromRPC(
        mangoGroup,
        mangoCache,
        perpMarket,
        price,
        sign,
        mangoAccounts,
      );
    }

    for (const account of accountsWithPnl) {
      // ignore own account explicitly
      if (account.publicKey.equals(mangoAccount.publicKey)) {
        continue;
      }
      if (
        ((pnl.isPos() && account.pnl.isNeg()) ||
          (pnl.isNeg() && account.pnl.isPos())) &&
        transaction.instructions.length < 10
      ) {
        // Account pnl must have opposite signs
        const instr = makeSettlePnlInstruction(
          this.programId,
          mangoGroup.publicKey,
          mangoAccount.publicKey,
          account.publicKey,
          mangoGroup.mangoCache,
          quoteRootBank.publicKey,
          quoteRootBank.nodeBanks[0],
          new BN(marketIndex),
        );
        transaction.add(instr);
        pnl = pnl.add(account.pnl);
        // if pnl has changed sign, then we're done
        const remSign = pnl.gt(ZERO_I80F48) ? 1 : -1;
        if (remSign !== sign) {
          break;
        }
      } else {
        // means we ran out of accounts to settle against (shouldn't happen) OR transaction too big
        // TODO - create a multi tx to be signed by user
        continue;
      }
    }

    return await this.sendTransaction(transaction, owner, additionalSigners);

    // Calculate the profit or loss per market
  }

  /**
   * Settle all perp accounts with positive pnl
   */
  async settlePosPnl(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    mangoAccount: MangoAccount,
    perpMarkets: PerpMarket[],
    quoteRootBank: RootBank,
    owner: Payer,
    mangoAccounts?: MangoAccount[],
  ): Promise<TransactionSignature[] | undefined> {
    // fetch all MangoAccounts filtered for having this perp market in basket
    if (mangoAccounts === undefined) {
      mangoAccounts = await this.getAllMangoAccounts(mangoGroup, [], false);
    }
    const signatures: (TransactionSignature | null)[] = await Promise.all(
      perpMarkets.map((pm) => {
        const marketIndex = mangoGroup.getPerpMarketIndex(pm.publicKey);
        const perpMarketInfo = mangoGroup.perpMarkets[marketIndex];
        const price = mangoCache.getPrice(marketIndex);
        const pnl = mangoAccount.perpAccounts[marketIndex].getPnl(
          perpMarketInfo,
          mangoCache.perpMarketCache[marketIndex],
          price,
        );
        return pnl.isPos()
          ? this.settlePnl(
              mangoGroup,
              mangoCache,
              mangoAccount,
              pm,
              quoteRootBank,
              mangoCache.getPrice(marketIndex),
              owner,
              mangoAccounts,
            )
          : promiseNull();
      }),
    );

    function filterNulls<TransactionSignature>(
      value: TransactionSignature | null,
    ): value is TransactionSignature {
      if (value === null) return false;
      return true;
    }

    const filtered = signatures?.filter(filterNulls);

    return filtered?.length ? filtered : undefined;
  }

  /**
   * Settle all perp accounts with any pnl
   */
  async settleAllPerpPnl(
    mangoGroup: MangoGroup,
    mangoCache: MangoCache,
    mangoAccount: MangoAccount,
    perpMarkets: PerpMarket[],
    quoteRootBank: RootBank,
    owner: Payer,
    mangoAccounts?: MangoAccount[],
  ): Promise<(TransactionSignature | null)[]> {
    // fetch all MangoAccounts filtered for having this perp market in basket
    if (mangoAccounts === undefined) {
      mangoAccounts = await this.getAllMangoAccounts(mangoGroup, [], false);
    }
    return await Promise.all(
      perpMarkets.map((pm) => {
        const marketIndex = mangoGroup.getPerpMarketIndex(pm.publicKey);
        const perpMarketInfo = mangoGroup.perpMarkets[marketIndex];
        const price = mangoCache.getPrice(marketIndex);
        const pnl = mangoAccount.perpAccounts[marketIndex].getPnl(
          perpMarketInfo,
          mangoCache.perpMarketCache[marketIndex],
          price,
        );
        return !pnl.isZero()
          ? this.settlePnl(
              mangoGroup,
              mangoCache,
              mangoAccount,
              pm,
              quoteRootBank,
              mangoCache.getPrice(marketIndex),
              owner,
              mangoAccounts,
            )
          : promiseNull();
      }),
    );
  }

  getMangoAccountsForOwner(
    mangoGroup: MangoGroup,
    owner: PublicKey,
    includeOpenOrders = false,
  ): Promise<MangoAccount[]> {
    const filters = [
      {
        memcmp: {
          offset: MangoAccountLayout.offsetOf('owner'),
          bytes: owner.toBase58(),
        },
      },
    ];

    return this.getAllMangoAccounts(mangoGroup, filters, includeOpenOrders);
  }

  /**
   * Get all MangoAccounts where `delegate` pubkey has authority
   */
  getMangoAccountsForDelegate(
    mangoGroup: MangoGroup,
    delegate: PublicKey,
    includeOpenOrders = false,
  ): Promise<MangoAccount[]> {
    const filters = [
      {
        memcmp: {
          offset: MangoAccountLayout.offsetOf('delegate'),
          bytes: delegate.toBase58(),
        },
      },
    ];
    return this.getAllMangoAccounts(mangoGroup, filters, includeOpenOrders);
  }

  async getAllMangoAccounts(
    mangoGroup: MangoGroup,
    filters?: any[],
    includeOpenOrders = true,
  ): Promise<MangoAccount[]> {
    const accountFilters = [
      {
        memcmp: {
          offset: MangoAccountLayout.offsetOf('mangoGroup'),
          bytes: mangoGroup.publicKey.toBase58(),
        },
      },
      {
        dataSize: MangoAccountLayout.span,
      },
    ];

    if (filters && filters.length) {
      accountFilters.push(...filters);
    }

    const mangoAccounts = await getFilteredProgramAccounts(
      this.connection,
      this.programId,
      accountFilters,
    ).then((accounts) =>
      accounts.map(({ publicKey, accountInfo }) => {
        return new MangoAccount(
          publicKey,
          MangoAccountLayout.decode(
            accountInfo == null ? undefined : accountInfo.data,
          ),
        );
      }),
    );

    if (includeOpenOrders) {
      const openOrderPks = mangoAccounts
        .map((ma) => ma.spotOpenOrders.filter((pk) => !pk.equals(zeroKey)))
        .flat();

      const openOrderAccountInfos = await getMultipleAccounts(
        this.connection,
        openOrderPks,
      );

      const openOrders = openOrderAccountInfos.map(
        ({ publicKey, accountInfo }) =>
          OpenOrders.fromAccountInfo(
            publicKey,
            accountInfo,
            mangoGroup.dexProgramId,
          ),
      );

      const pkToOpenOrdersAccount = {};
      openOrders.forEach((openOrdersAccount) => {
        pkToOpenOrdersAccount[openOrdersAccount.publicKey.toBase58()] =
          openOrdersAccount;
      });

      for (const ma of mangoAccounts) {
        for (let i = 0; i < ma.spotOpenOrders.length; i++) {
          if (ma.spotOpenOrders[i].toBase58() in pkToOpenOrdersAccount) {
            ma.spotOpenOrdersAccounts[i] =
              pkToOpenOrdersAccount[ma.spotOpenOrders[i].toBase58()];
          }
        }
      }
    }

    return mangoAccounts;
  }

  async addStubOracle(mangoGroupPk: PublicKey, admin: Keypair) {
    const createOracleAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      StubOracleLayout.span,
      this.programId,
    );

    const instruction = makeAddOracleInstruction(
      this.programId,
      mangoGroupPk,
      createOracleAccountInstruction.account.publicKey,
      admin.publicKey,
    );

    const transaction = new Transaction();
    transaction.add(createOracleAccountInstruction.instruction);
    transaction.add(instruction);

    const additionalSigners = [createOracleAccountInstruction.account];
    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  async setStubOracle(
    mangoGroupPk: PublicKey,
    oraclePk: PublicKey,
    admin: Keypair,
    price: number,
  ) {
    const instruction = makeSetOracleInstruction(
      this.programId,
      mangoGroupPk,
      oraclePk,
      admin.publicKey,
      I80F48.fromNumber(price),
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    const additionalSigners = [];
    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  async addPerpMarket(
    mangoGroup: MangoGroup,
    oraclePk: PublicKey,
    mngoMintPk: PublicKey,
    admin: Keypair,
    maintLeverage: number,
    initLeverage: number,
    liquidationFee: number,
    makerFee: number,
    takerFee: number,
    baseLotSize: number,
    quoteLotSize: number,
    maxNumEvents: number,
    rate: number, // liquidity mining params; set rate == 0 if no liq mining
    maxDepthBps: number,
    targetPeriodLength: number,
    mngoPerPeriod: number,
    exp: number,
  ) {
    const makePerpMarketAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      PerpMarketLayout.span,
      this.programId,
    );

    const makeEventQueueAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      PerpEventQueueHeaderLayout.span + maxNumEvents * PerpEventLayout.span,
      this.programId,
    );

    const makeBidAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      BookSideLayout.span,
      this.programId,
    );

    const makeAskAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      BookSideLayout.span,
      this.programId,
    );

    const mngoVaultAccount = new Keypair();
    const mngoVaultAccountInstructions = await createTokenAccountInstructions(
      this.connection,
      admin.publicKey,
      mngoVaultAccount.publicKey,
      mngoMintPk,
      mangoGroup.signerKey,
    );

    const instruction = await makeAddPerpMarketInstruction(
      this.programId,
      mangoGroup.publicKey,
      oraclePk,
      makePerpMarketAccountInstruction.account.publicKey,
      makeEventQueueAccountInstruction.account.publicKey,
      makeBidAccountInstruction.account.publicKey,
      makeAskAccountInstruction.account.publicKey,
      mngoVaultAccount.publicKey,
      admin.publicKey,
      I80F48.fromNumber(maintLeverage),
      I80F48.fromNumber(initLeverage),
      I80F48.fromNumber(liquidationFee),
      I80F48.fromNumber(makerFee),
      I80F48.fromNumber(takerFee),
      new BN(baseLotSize),
      new BN(quoteLotSize),
      I80F48.fromNumber(rate),
      I80F48.fromNumber(maxDepthBps),
      new BN(targetPeriodLength),
      new BN(mngoPerPeriod),
      new BN(exp),
    );

    const createMngoVaultTransaction = new Transaction();
    createMngoVaultTransaction.add(...mngoVaultAccountInstructions);
    await this.sendTransaction(createMngoVaultTransaction, admin, [
      mngoVaultAccount,
    ]);

    const transaction = new Transaction();
    transaction.add(makePerpMarketAccountInstruction.instruction);
    transaction.add(makeEventQueueAccountInstruction.instruction);
    transaction.add(makeBidAccountInstruction.instruction);
    transaction.add(makeAskAccountInstruction.instruction);
    transaction.add(instruction);

    const additionalSigners = [
      makePerpMarketAccountInstruction.account,
      makeEventQueueAccountInstruction.account,
      makeBidAccountInstruction.account,
      makeAskAccountInstruction.account,
    ];

    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  async createPerpMarket(
    mangoGroup: MangoGroup,
    oraclePk: PublicKey,
    mngoMintPk: PublicKey,
    admin: Payer,
    maintLeverage: number,
    initLeverage: number,
    liquidationFee: number,
    makerFee: number,
    takerFee: number,
    baseLotSize: number,
    quoteLotSize: number,
    maxNumEvents: number,
    rate: number, // liquidity mining params; set rate == 0 if no liq mining
    maxDepthBps: number,
    targetPeriodLength: number,
    mngoPerPeriod: number,
    exp: number,
    version: number,
    lmSizeShift: number,
    baseDecimals: number,
  ) {
    if (!admin.publicKey) {
      return;
    }
    const [perpMarketPk] = await PublicKey.findProgramAddress(
      [
        mangoGroup.publicKey.toBytes(),
        new Buffer('PerpMarket', 'utf-8'),
        oraclePk.toBytes(),
      ],
      this.programId,
    );
    const makeEventQueueAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      PerpEventQueueHeaderLayout.span + maxNumEvents * PerpEventLayout.span,
      this.programId,
    );

    const makeBidAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      BookSideLayout.span,
      this.programId,
    );

    const makeAskAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      BookSideLayout.span,
      this.programId,
    );

    const [mngoVaultPk] = await PublicKey.findProgramAddress(
      [
        perpMarketPk.toBytes(),
        TOKEN_PROGRAM_ID.toBytes(),
        mngoMintPk.toBytes(),
      ],
      this.programId,
    );
    const instruction = await makeCreatePerpMarketInstruction(
      this.programId,
      mangoGroup.publicKey,
      oraclePk,
      perpMarketPk,
      makeEventQueueAccountInstruction.account.publicKey,
      makeBidAccountInstruction.account.publicKey,
      makeAskAccountInstruction.account.publicKey,
      mngoMintPk,
      mngoVaultPk,
      admin.publicKey,
      mangoGroup.signerKey,
      I80F48.fromNumber(maintLeverage),
      I80F48.fromNumber(initLeverage),
      I80F48.fromNumber(liquidationFee),
      I80F48.fromNumber(makerFee),
      I80F48.fromNumber(takerFee),
      new BN(baseLotSize),
      new BN(quoteLotSize),
      I80F48.fromNumber(rate),
      I80F48.fromNumber(maxDepthBps),
      new BN(targetPeriodLength),
      new BN(mngoPerPeriod),
      new BN(exp),
      new BN(version),
      new BN(lmSizeShift),
      new BN(baseDecimals),
    );

    const transaction = new Transaction();
    transaction.add(makeEventQueueAccountInstruction.instruction);
    transaction.add(makeBidAccountInstruction.instruction);
    transaction.add(makeAskAccountInstruction.instruction);
    transaction.add(instruction);

    const additionalSigners = [
      makeEventQueueAccountInstruction.account,
      makeBidAccountInstruction.account,
      makeAskAccountInstruction.account,
    ];

    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  // Liquidator Functions
  async forceCancelSpotOrders(
    mangoGroup: MangoGroup,
    liqeeMangoAccount: MangoAccount,
    spotMarket: Market,
    baseRootBank: RootBank,
    quoteRootBank: RootBank,
    payer: Keypair,
    limit: BN,
  ) {
    const baseNodeBanks = await baseRootBank.loadNodeBanks(this.connection);
    const quoteNodeBanks = await quoteRootBank.loadNodeBanks(this.connection);

    const openOrdersKeys: { pubkey: PublicKey; isWritable: boolean }[] = [];
    const spotMarketIndex = mangoGroup.getSpotMarketIndex(spotMarket.publicKey);
    // Only pass in open orders if in margin basket or current market index, and
    // the only writable account should be OpenOrders for current market index
    for (let i = 0; i < liqeeMangoAccount.spotOpenOrders.length; i++) {
      let pubkey = zeroKey;
      let isWritable = false;

      if (i === spotMarketIndex) {
        isWritable = true;

        if (liqeeMangoAccount.spotOpenOrders[spotMarketIndex].equals(zeroKey)) {
          console.log('missing oo for ', spotMarketIndex);
          // open orders missing for this market; create a new one now
          // const openOrdersSpace = OpenOrders.getLayout(
          //   mangoGroup.dexProgramId,
          // ).span;
          // const openOrdersLamports =
          //   await this.connection.getMinimumBalanceForRentExemption(
          //     openOrdersSpace,
          //     'singleGossip',
          //   );
          // const accInstr = await createAccountInstruction(
          //   this.connection,
          //   owner.publicKey,
          //   openOrdersSpace,
          //   mangoGroup.dexProgramId,
          //   openOrdersLamports,
          // );

          // transaction.add(accInstr.instruction);
          // additionalSigners.push(accInstr.account);
          // pubkey = accInstr.account.publicKey;
        } else {
          pubkey = liqeeMangoAccount.spotOpenOrders[i];
        }
      } else if (liqeeMangoAccount.inMarginBasket[i]) {
        pubkey = liqeeMangoAccount.spotOpenOrders[i];
      }

      openOrdersKeys.push({ pubkey, isWritable });
    }

    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId,
    );

    const instruction = makeForceCancelSpotOrdersInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      liqeeMangoAccount.publicKey,
      baseRootBank.publicKey,
      baseNodeBanks[0].publicKey,
      baseNodeBanks[0].vault,
      quoteRootBank.publicKey,
      quoteNodeBanks[0].publicKey,
      quoteNodeBanks[0].vault,
      spotMarket.publicKey,
      spotMarket.bidsAddress,
      spotMarket.asksAddress,
      mangoGroup.signerKey,
      spotMarket['_decoded'].eventQueue,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      dexSigner,
      mangoGroup.dexProgramId,
      openOrdersKeys,
      limit,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  /**
   * Send multiple instructions to cancel all perp orders in this market
   */
  async forceCancelAllPerpOrdersInMarket(
    mangoGroup: MangoGroup,
    liqee: MangoAccount,
    perpMarket: PerpMarket,
    payer: Payer,
    limitPerInstruction: number,
  ): Promise<TransactionSignature> {
    const transaction = new Transaction();
    const marketIndex = mangoGroup.getPerpMarketIndex(perpMarket.publicKey);
    const instruction = makeForceCancelPerpOrdersInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      liqee.publicKey,
      liqee.spotOpenOrders,
      new BN(limitPerInstruction),
    );
    transaction.add(instruction);

    let orderCount = 0;
    for (let i = 0; i < liqee.orderMarket.length; i++) {
      if (liqee.orderMarket[i] !== marketIndex) {
        continue;
      }
      orderCount++;
      if (orderCount === limitPerInstruction) {
        orderCount = 0;
        const instruction = makeForceCancelPerpOrdersInstruction(
          this.programId,
          mangoGroup.publicKey,
          mangoGroup.mangoCache,
          perpMarket.publicKey,
          perpMarket.bids,
          perpMarket.asks,
          liqee.publicKey,
          liqee.spotOpenOrders,
          new BN(limitPerInstruction),
        );
        transaction.add(instruction);

        // TODO - verify how many such instructions can go into one tx
        // right now 10 seems reasonable considering size of 800ish bytes if all spot open orders present
        if (transaction.instructions.length === 10) {
          break;
        }
      }
    }

    return await this.sendTransaction(transaction, payer, []);
  }

  async forceCancelPerpOrders(
    mangoGroup: MangoGroup,
    liqeeMangoAccount: MangoAccount,
    perpMarket: PerpMarket,
    payer: Keypair,
    limit: BN,
  ) {
    const instruction = makeForceCancelPerpOrdersInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      liqeeMangoAccount.publicKey,
      liqeeMangoAccount.spotOpenOrders,
      limit,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async liquidateTokenAndToken(
    mangoGroup: MangoGroup,
    liqeeMangoAccount: MangoAccount,
    liqorMangoAccount: MangoAccount,
    assetRootBank: RootBank,
    liabRootBank: RootBank,
    payer: Keypair,
    maxLiabTransfer: I80F48,
  ) {
    const instruction = makeLiquidateTokenAndTokenInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      liqeeMangoAccount.publicKey,
      liqorMangoAccount.publicKey,
      payer.publicKey,
      assetRootBank.publicKey,
      assetRootBank.nodeBanks[0],
      liabRootBank.publicKey,
      liabRootBank.nodeBanks[0],
      liqeeMangoAccount.getOpenOrdersKeysInBasket(),
      liqorMangoAccount.getOpenOrdersKeysInBasket(),
      maxLiabTransfer,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async liquidateTokenAndPerp(
    mangoGroup: MangoGroup,
    liqeeMangoAccount: MangoAccount,
    liqorMangoAccount: MangoAccount,
    rootBank: RootBank,
    payer: Keypair,
    assetType: AssetType,
    assetIndex: number,
    liabType: AssetType,
    liabIndex: number,
    maxLiabTransfer: I80F48,
  ) {
    const instruction = makeLiquidateTokenAndPerpInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      liqeeMangoAccount.publicKey,
      liqorMangoAccount.publicKey,
      payer.publicKey,
      rootBank.publicKey,
      rootBank.nodeBanks[0],
      liqeeMangoAccount.getOpenOrdersKeysInBasket(),
      liqorMangoAccount.getOpenOrdersKeysInBasket(),
      assetType,
      new BN(assetIndex),
      liabType,
      new BN(liabIndex),
      maxLiabTransfer,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async liquidatePerpMarket(
    mangoGroup: MangoGroup,
    liqeeMangoAccount: MangoAccount,
    liqorMangoAccount: MangoAccount,
    perpMarket: PerpMarket,
    payer: Keypair,
    baseTransferRequest: BN,
  ) {
    const instruction = makeLiquidatePerpMarketInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      perpMarket.publicKey,
      perpMarket.eventQueue,
      liqeeMangoAccount.publicKey,
      liqorMangoAccount.publicKey,
      payer.publicKey,
      liqeeMangoAccount.getOpenOrdersKeysInBasket(),
      liqorMangoAccount.getOpenOrdersKeysInBasket(),
      baseTransferRequest,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async settleFees(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    perpMarket: PerpMarket,
    rootBank: RootBank,
    payer: Keypair,
  ) {
    const nodeBanks = await rootBank.loadNodeBanks(this.connection);

    const instruction = makeSettleFeesInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      perpMarket.publicKey,
      mangoAccount.publicKey,
      rootBank.publicKey,
      nodeBanks[0].publicKey,
      nodeBanks[0].vault,
      mangoGroup.feesVault,
      mangoGroup.signerKey,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async resolvePerpBankruptcy(
    mangoGroup: MangoGroup,
    liqeeMangoAccount: MangoAccount,
    liqorMangoAccount: MangoAccount,
    perpMarket: PerpMarket,
    rootBank: RootBank,
    payer: Keypair,
    liabIndex: number,
    maxLiabTransfer: I80F48,
  ) {
    const nodeBanks = await rootBank.loadNodeBanks(this.connection);
    const instruction = makeResolvePerpBankruptcyInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      liqeeMangoAccount.publicKey,
      liqorMangoAccount.publicKey,
      payer.publicKey,
      rootBank.publicKey,
      nodeBanks[0].publicKey,
      nodeBanks[0].vault,
      mangoGroup.insuranceVault,
      mangoGroup.signerKey,
      perpMarket.publicKey,
      liqorMangoAccount.spotOpenOrders,
      new BN(liabIndex),
      maxLiabTransfer,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async resolveTokenBankruptcy(
    mangoGroup: MangoGroup,
    liqeeMangoAccount: MangoAccount,
    liqorMangoAccount: MangoAccount,
    quoteRootBank: RootBank,
    liabRootBank: RootBank,
    payer: Keypair,
    maxLiabTransfer: I80F48,
  ) {
    const quoteNodeBanks = await quoteRootBank.loadNodeBanks(this.connection);
    const instruction = makeResolveTokenBankruptcyInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      liqeeMangoAccount.publicKey,
      liqorMangoAccount.publicKey,
      payer.publicKey,
      quoteRootBank.publicKey,
      quoteRootBank.nodeBanks[0],
      quoteNodeBanks[0].vault,
      mangoGroup.insuranceVault,
      mangoGroup.signerKey,
      liabRootBank.publicKey,
      liabRootBank.nodeBanks[0],
      liqorMangoAccount.spotOpenOrders,
      liabRootBank.nodeBanks,
      maxLiabTransfer,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async redeemMngo(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    perpMarket: PerpMarket,
    payer: Payer,
    mngoRootBank: PublicKey,
    mngoNodeBank: PublicKey,
    mngoVault: PublicKey,
  ): Promise<TransactionSignature | undefined> {
    if (!payer.publicKey) {
      return;
    }
    const instruction = makeRedeemMngoInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      mangoAccount.publicKey,
      payer.publicKey,
      perpMarket.publicKey,
      perpMarket.mngoVault,
      mngoRootBank,
      mngoNodeBank,
      mngoVault,
      mangoGroup.signerKey,
    );
    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async redeemAllMngo(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    payer: Payer,
    mngoRootBank: PublicKey,
    mngoNodeBank: PublicKey,
    mngoVault: PublicKey,
  ): Promise<TransactionSignature[] | undefined> {
    if (!payer.publicKey) {
      return;
    }
    const transactions: Transaction[] = [];
    let transaction = new Transaction();

    const perpMarkets = await Promise.all(
      mangoAccount.perpAccounts.map((perpAccount, i) => {
        if (perpAccount.mngoAccrued.eq(ZERO_BN)) {
          return promiseUndef();
        } else {
          return this.getPerpMarket(
            mangoGroup.perpMarkets[i].perpMarket,
            mangoGroup.tokens[i].decimals,
            mangoGroup.tokens[QUOTE_INDEX].decimals,
          );
        }
      }),
    );

    for (let i = 0; i < mangoAccount.perpAccounts.length; i++) {
      const perpMarket = perpMarkets[i];
      if (perpMarket === undefined) continue;

      const instruction = makeRedeemMngoInstruction(
        this.programId,
        mangoGroup.publicKey,
        mangoGroup.mangoCache,
        mangoAccount.publicKey,
        payer.publicKey,
        perpMarket.publicKey,
        perpMarket.mngoVault,
        mngoRootBank,
        mngoNodeBank,
        mngoVault,
        mangoGroup.signerKey,
      );
      transaction.add(instruction);
      if (transaction.instructions.length === 9) {
        transactions.push(transaction);
        transaction = new Transaction();
      }
    }
    if (transaction.instructions.length > 0) {
      transactions.push(transaction);

      // txProms.push(this.sendTransaction(transaction, payer, []));
    }

    const transactionsAndSigners = transactions.map((tx) => ({
      transaction: tx,
      signers: [],
    }));

    if (transactionsAndSigners.length === 0) {
      throw new Error('No MNGO rewards to redeem');
    }

    const currentBlockhash = await this.getCurrentBlockhash();
    const signedTransactions = await this.signTransactions({
      transactionsAndSigners,
      payer,
      currentBlockhash,
    });

    if (signedTransactions) {
      const txSigs = await Promise.all(
        signedTransactions.map((signedTransaction) =>
          this.sendSignedTransaction({
            signedTransaction,
            signedAtBlock: currentBlockhash,
          }),
        ),
      );
      return txSigs;
    } else {
      throw new Error('Unable to sign all RedeemMngo transactions');
    }
  }

  async addMangoAccountInfo(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Payer,
    info: string,
  ): Promise<TransactionSignature | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const instruction = makeAddMangoAccountInfoInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      owner.publicKey,
      info,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async depositMsrm(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Payer,
    msrmAccount: PublicKey,
    quantity: number,
  ): Promise<TransactionSignature | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const instruction = makeDepositMsrmInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      owner.publicKey,
      msrmAccount,
      mangoGroup.msrmVault,
      new BN(Math.floor(quantity)),
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }
  async withdrawMsrm(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Payer,
    msrmAccount: PublicKey,
    quantity: number,
  ): Promise<TransactionSignature | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const instruction = makeWithdrawMsrmInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      owner.publicKey,
      msrmAccount,
      mangoGroup.msrmVault,
      mangoGroup.signerKey,
      new BN(Math.floor(quantity)),
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async changePerpMarketParams(
    mangoGroup: MangoGroup,
    perpMarket: PerpMarket,
    admin: Payer,

    maintLeverage: number | undefined,
    initLeverage: number | undefined,
    liquidationFee: number | undefined,
    makerFee: number | undefined,
    takerFee: number | undefined,
    rate: number | undefined,
    maxDepthBps: number | undefined,
    targetPeriodLength: number | undefined,
    mngoPerPeriod: number | undefined,
    exp: number | undefined,
  ): Promise<TransactionSignature | undefined> {
    if (!admin.publicKey) {
      return;
    }
    const instruction = makeChangePerpMarketParamsInstruction(
      this.programId,
      mangoGroup.publicKey,
      perpMarket.publicKey,
      admin.publicKey,
      I80F48.fromNumberOrUndef(maintLeverage),
      I80F48.fromNumberOrUndef(initLeverage),
      I80F48.fromNumberOrUndef(liquidationFee),
      I80F48.fromNumberOrUndef(makerFee),
      I80F48.fromNumberOrUndef(takerFee),
      I80F48.fromNumberOrUndef(rate),
      I80F48.fromNumberOrUndef(maxDepthBps),
      targetPeriodLength !== undefined ? new BN(targetPeriodLength) : undefined,
      mngoPerPeriod !== undefined ? new BN(mngoPerPeriod) : undefined,
      exp !== undefined ? new BN(exp) : undefined,
    );

    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];

    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  async changePerpMarketParams2(
    mangoGroup: MangoGroup,
    perpMarket: PerpMarket,
    admin: Payer,

    maintLeverage: number | undefined,
    initLeverage: number | undefined,
    liquidationFee: number | undefined,
    makerFee: number | undefined,
    takerFee: number | undefined,
    rate: number | undefined,
    maxDepthBps: number | undefined,
    targetPeriodLength: number | undefined,
    mngoPerPeriod: number | undefined,
    exp: number | undefined,
    version: number | undefined,
    lmSizeShift: number | undefined,
  ): Promise<TransactionSignature | undefined> {
    if (!admin.publicKey) {
      return;
    }
    const instruction = makeChangePerpMarketParams2Instruction(
      this.programId,
      mangoGroup.publicKey,
      perpMarket.publicKey,
      admin.publicKey,
      I80F48.fromNumberOrUndef(maintLeverage),
      I80F48.fromNumberOrUndef(initLeverage),
      I80F48.fromNumberOrUndef(liquidationFee),
      I80F48.fromNumberOrUndef(makerFee),
      I80F48.fromNumberOrUndef(takerFee),
      I80F48.fromNumberOrUndef(rate),
      I80F48.fromNumberOrUndef(maxDepthBps),
      targetPeriodLength !== undefined ? new BN(targetPeriodLength) : undefined,
      mngoPerPeriod !== undefined ? new BN(mngoPerPeriod) : undefined,
      exp !== undefined ? new BN(exp) : undefined,
      version !== undefined ? new BN(version) : undefined,
      lmSizeShift !== undefined ? new BN(lmSizeShift) : undefined,
    );

    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];

    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  async setGroupAdmin(
    mangoGroup: MangoGroup,
    newAdmin: PublicKey,
    admin: Payer,
  ): Promise<TransactionSignature | undefined> {
    if (!admin.publicKey) {
      return;
    }
    const instruction = makeSetGroupAdminInstruction(
      this.programId,
      mangoGroup.publicKey,
      newAdmin,
      admin.publicKey,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  /**
   * Add allowance for orders to be cancelled and replaced in a single transaction
   */
  async modifySpotOrder(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    mangoCache: PublicKey,
    spotMarket: Market,
    owner: Payer,
    order: Order,

    side: 'buy' | 'sell',
    price: number,
    size: number,
    orderType?: 'limit' | 'ioc' | 'postOnly',
  ): Promise<TransactionSignature | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const transaction = new Transaction();

    const instruction = makeCancelSpotOrderInstruction(
      this.programId,
      mangoGroup.publicKey,
      owner.publicKey,
      mangoAccount.publicKey,
      spotMarket.programId,
      spotMarket.publicKey,
      spotMarket['_decoded'].bids,
      spotMarket['_decoded'].asks,
      order.openOrdersAddress,
      mangoGroup.signerKey,
      spotMarket['_decoded'].eventQueue,
      order,
    );
    transaction.add(instruction);

    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId,
    );

    const spotMarketIndex = mangoGroup.getSpotMarketIndex(spotMarket.publicKey);
    if (!mangoGroup.rootBankAccounts.length) {
      await mangoGroup.loadRootBanks(this.connection);
    }
    const baseRootBank = mangoGroup.rootBankAccounts[spotMarketIndex];
    const baseNodeBank = baseRootBank?.nodeBankAccounts[0];
    const quoteRootBank = mangoGroup.rootBankAccounts[QUOTE_INDEX];
    const quoteNodeBank = quoteRootBank?.nodeBankAccounts[0];

    if (!baseNodeBank || !quoteNodeBank) {
      throw new Error('Invalid or missing node banks');
    }
    const settleFundsInstruction = makeSettleFundsInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      owner.publicKey,
      mangoAccount.publicKey,
      spotMarket.programId,
      spotMarket.publicKey,
      mangoAccount.spotOpenOrders[spotMarketIndex],
      mangoGroup.signerKey,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      mangoGroup.tokens[spotMarketIndex].rootBank,
      baseNodeBank.publicKey,
      mangoGroup.tokens[QUOTE_INDEX].rootBank,
      quoteNodeBank.publicKey,
      baseNodeBank.vault,
      quoteNodeBank.vault,
      dexSigner,
    );
    transaction.add(settleFundsInstruction);

    const additionalSigners: Keypair[] = [];

    const limitPrice = spotMarket.priceNumberToLots(price);
    const maxBaseQuantity = spotMarket.baseSizeNumberToLots(size);

    // TODO implement srm vault fee discount
    // const feeTier = getFeeTier(0, nativeToUi(mangoGroup.nativeSrm || 0, SRM_DECIMALS));
    const feeTier = getFeeTier(0, nativeToUi(0, 0));
    const rates = getFeeRates(feeTier);
    const maxQuoteQuantity = new BN(
      spotMarket['_decoded'].quoteLotSize.toNumber() * (1 + rates.taker),
    ).mul(
      spotMarket
        .baseSizeNumberToLots(size)
        .mul(spotMarket.priceNumberToLots(price)),
    );

    // Checks already completed as only price modified
    if (maxBaseQuantity.lte(ZERO_BN)) {
      throw new Error('size too small');
    }
    if (limitPrice.lte(ZERO_BN)) {
      throw new Error('invalid price');
    }
    const selfTradeBehavior = 'decrementTake';

    if (!baseRootBank || !baseNodeBank || !quoteRootBank || !quoteNodeBank) {
      throw new Error('Invalid or missing banks');
    }

    const openOrdersKeys: { pubkey: PublicKey; isWritable: boolean }[] = [];

    // Only pass in open orders if in margin basket or current market index, and
    // the only writable account should be OpenOrders for current market index
    for (let i = 0; i < mangoAccount.spotOpenOrders.length; i++) {
      let pubkey = zeroKey;
      let isWritable = false;

      if (i === spotMarketIndex) {
        isWritable = true;

        if (mangoAccount.spotOpenOrders[spotMarketIndex].equals(zeroKey)) {
          // open orders missing for this market; create a new one now
          const openOrdersSpace = OpenOrders.getLayout(
            mangoGroup.dexProgramId,
          ).span;

          const openOrdersLamports =
            await this.connection.getMinimumBalanceForRentExemption(
              openOrdersSpace,
              'processed',
            );

          const accInstr = await createAccountInstruction(
            this.connection,
            owner.publicKey,
            openOrdersSpace,
            mangoGroup.dexProgramId,
            openOrdersLamports,
          );

          const initOpenOrders = makeInitSpotOpenOrdersInstruction(
            this.programId,
            mangoGroup.publicKey,
            mangoAccount.publicKey,
            owner.publicKey,
            mangoGroup.dexProgramId,
            accInstr.account.publicKey,
            spotMarket.publicKey,
            mangoGroup.signerKey,
          );

          const initTx = new Transaction();

          initTx.add(accInstr.instruction);
          initTx.add(initOpenOrders);

          await this.sendTransaction(initTx, owner, [accInstr.account]);

          pubkey = accInstr.account.publicKey;
        } else {
          pubkey = mangoAccount.spotOpenOrders[i];
        }
      } else if (mangoAccount.inMarginBasket[i]) {
        pubkey = mangoAccount.spotOpenOrders[i];
      }

      openOrdersKeys.push({ pubkey, isWritable });
    }

    const placeOrderInstruction = makePlaceSpotOrderInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      owner.publicKey,
      mangoCache,
      spotMarket.programId,
      spotMarket.publicKey,
      spotMarket['_decoded'].bids,
      spotMarket['_decoded'].asks,
      spotMarket['_decoded'].requestQueue,
      spotMarket['_decoded'].eventQueue,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      baseRootBank.publicKey,
      baseNodeBank.publicKey,
      baseNodeBank.vault,
      quoteRootBank.publicKey,
      quoteNodeBank.publicKey,
      quoteNodeBank.vault,
      mangoGroup.signerKey,
      dexSigner,
      mangoGroup.srmVault, // TODO: choose msrm vault if it has any deposits
      openOrdersKeys,
      side,
      limitPrice,
      maxBaseQuantity,
      maxQuoteQuantity,
      selfTradeBehavior,
      orderType,
      order.clientId,
    );
    transaction.add(placeOrderInstruction);

    if (spotMarketIndex > 0) {
      console.log(
        spotMarketIndex - 1,
        mangoAccount.spotOpenOrders[spotMarketIndex - 1].toBase58(),
        openOrdersKeys[spotMarketIndex - 1].pubkey.toBase58(),
      );
    }
    const txid = await this.sendTransaction(
      transaction,
      owner,
      additionalSigners,
    );

    // update MangoAccount to have new OpenOrders pubkey
    mangoAccount.spotOpenOrders[spotMarketIndex] =
      openOrdersKeys[spotMarketIndex].pubkey;
    mangoAccount.inMarginBasket[spotMarketIndex] = true;
    console.log(
      spotMarketIndex,
      mangoAccount.spotOpenOrders[spotMarketIndex].toBase58(),
      openOrdersKeys[spotMarketIndex].pubkey.toBase58(),
    );

    return txid;
  }

  async modifyPerpOrder(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    mangoCache: PublicKey,
    perpMarket: PerpMarket,
    owner: Payer,
    order: PerpOrder,

    side: 'buy' | 'sell',
    price: number,
    quantity: number,
    orderType?: PerpOrderType,
    clientOrderId?: number,
    bookSideInfo?: AccountInfo<Buffer>, // ask if side === bid, bids if side === ask; if this is given; crank instruction is added
    invalidIdOk = false, // Don't throw error if order is invalid
    referrerMangoAccountPk?: PublicKey,
  ): Promise<TransactionSignature | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const transaction = new Transaction();
    const additionalSigners: Keypair[] = [];

    const cancelInstruction = makeCancelPerpOrderInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      owner.publicKey,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      order,
      invalidIdOk,
    );

    transaction.add(cancelInstruction);

    const [nativePrice, nativeQuantity] = perpMarket.uiToNativePriceQuantity(
      price,
      quantity,
    );

    const placeInstruction = makePlacePerpOrderInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      owner.publicKey,
      mangoCache,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      perpMarket.eventQueue,
      mangoAccount.spotOpenOrders,
      nativePrice,
      nativeQuantity,
      clientOrderId
        ? new BN(clientOrderId)
        : order.clientId ?? new BN(Date.now()),
      side,
      orderType,
      false,
      referrerMangoAccountPk,
    );
    transaction.add(placeInstruction);

    if (bookSideInfo) {
      const bookSide = bookSideInfo.data
        ? new BookSide(
            side === 'buy' ? perpMarket.asks : perpMarket.bids,
            perpMarket,
            BookSideLayout.decode(bookSideInfo.data),
          )
        : [];
      const accounts: Set<string> = new Set();
      accounts.add(mangoAccount.publicKey.toBase58());

      for (const order of bookSide) {
        accounts.add(order.owner.toBase58());
        if (accounts.size >= 10) {
          break;
        }
      }

      const consumeInstruction = makeConsumeEventsInstruction(
        this.programId,
        mangoGroup.publicKey,
        mangoGroup.mangoCache,
        perpMarket.publicKey,
        perpMarket.eventQueue,
        Array.from(accounts)
          .map((s) => new PublicKey(s))
          .sort(),
        new BN(4),
      );
      transaction.add(consumeInstruction);
    }

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async addPerpTriggerOrder(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    perpMarket: PerpMarket,
    owner: Payer,
    orderType: PerpOrderType,
    side: 'buy' | 'sell',
    price: number,
    quantity: number,
    triggerCondition: 'above' | 'below',
    triggerPrice: number,
    reduceOnly: boolean,
    clientOrderId?: number,
  ): Promise<TransactionSignature | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const transaction = new Transaction();
    const additionalSigners: Keypair[] = [];

    let advancedOrders: PublicKey = mangoAccount.advancedOrdersKey;
    if (mangoAccount.advancedOrdersKey.equals(zeroKey)) {
      [advancedOrders] = await PublicKey.findProgramAddress(
        [mangoAccount.publicKey.toBytes()],
        this.programId,
      );

      console.log('AdvancedOrders PDA:', advancedOrders.toBase58());

      transaction.add(
        makeInitAdvancedOrdersInstruction(
          this.programId,
          mangoGroup.publicKey,
          mangoAccount.publicKey,
          owner.publicKey,
          advancedOrders,
        ),
      );
    }

    const marketIndex = mangoGroup.getPerpMarketIndex(perpMarket.publicKey);

    const baseTokenInfo = mangoGroup.tokens[marketIndex];
    const quoteTokenInfo = mangoGroup.tokens[QUOTE_INDEX];
    const baseUnit = Math.pow(10, baseTokenInfo.decimals);
    const quoteUnit = Math.pow(10, quoteTokenInfo.decimals);

    const nativePrice = new BN(price * quoteUnit)
      .mul(perpMarket.baseLotSize)
      .div(perpMarket.quoteLotSize.mul(new BN(baseUnit)));
    const nativeQuantity = new BN(quantity * baseUnit).div(
      perpMarket.baseLotSize,
    );

    const nativeTriggerPrice = I80F48.fromNumber(
      triggerPrice *
        Math.pow(10, perpMarket.quoteDecimals - perpMarket.baseDecimals),
    );
    const openOrders = mangoAccount.spotOpenOrders.filter(
      (pk, i) => mangoAccount.inMarginBasket[i],
    );

    transaction.add(
      makeAddPerpTriggerOrderInstruction(
        this.programId,
        mangoGroup.publicKey,
        mangoAccount.publicKey,
        owner.publicKey,
        advancedOrders,
        mangoGroup.mangoCache,
        perpMarket.publicKey,
        openOrders,
        orderType,
        side,
        nativePrice,
        nativeQuantity,
        triggerCondition,
        nativeTriggerPrice,
        reduceOnly,
        new BN(clientOrderId ?? Date.now()),
      ),
    );
    const txid = await this.sendTransaction(
      transaction,
      owner,
      additionalSigners,
    );
    mangoAccount.advancedOrdersKey = advancedOrders;
    return txid;
  }

  async removeAdvancedOrder(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Payer,
    orderIndex: number,
  ): Promise<TransactionSignature | undefined> {
    if (!owner.publicKey) {
      return;
    }
    const instruction = makeRemoveAdvancedOrderInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      owner.publicKey,
      mangoAccount.advancedOrdersKey,
      orderIndex,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async executePerpTriggerOrder(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    mangoCache: MangoCache,
    perpMarket: PerpMarket,
    payer: Payer,
    orderIndex: number,
  ): Promise<TransactionSignature | undefined> {
    if (!payer.publicKey) {
      return;
    }
    const openOrders = mangoAccount.spotOpenOrders.filter(
      (pk, i) => mangoAccount.inMarginBasket[i],
    );

    const instruction = makeExecutePerpTriggerOrderInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      mangoAccount.advancedOrdersKey,
      payer.publicKey,
      mangoCache.publicKey,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      perpMarket.eventQueue,
      openOrders,
      new BN(orderIndex),
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async closeAdvancedOrders(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    payer: Payer,
  ): Promise<TransactionSignature | undefined> {
    if (!payer.publicKey) {
      return;
    }
    const instruction = makeCloseAdvancedOrdersInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      payer.publicKey,
      mangoAccount.advancedOrdersKey,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async closeSpotOpenOrders(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    payer: Payer,
    marketIndex: number,
  ): Promise<TransactionSignature | undefined> {
    if (!payer.publicKey) {
      return;
    }
    const instruction = makeCloseSpotOpenOrdersInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      payer.publicKey,
      mangoGroup.dexProgramId,
      mangoAccount.spotOpenOrders[marketIndex],
      mangoGroup.spotMarkets[marketIndex].spotMarket,
      mangoGroup.signerKey,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async closeMangoAccount(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    payer: Payer,
  ): Promise<TransactionSignature | undefined> {
    if (!payer.publicKey) {
      return;
    }
    const instruction = makeCloseMangoAccountInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      payer.publicKey,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async createDustAccount(
    mangoGroup: MangoGroup,
    payer: Payer,
  ): Promise<TransactionSignature | undefined> {
    if (!payer.publicKey) {
      return;
    }
    const [mangoAccountPk] = await PublicKey.findProgramAddress(
      [mangoGroup.publicKey.toBytes(), new Buffer('DustAccount', 'utf-8')],
      this.programId,
    );
    const instruction = makeCreateDustAccountInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccountPk,
      payer.publicKey,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async resolveDust(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    rootBank: RootBank,
    mangoCache: MangoCache,
    payer: Payer,
  ): Promise<TransactionSignature | undefined> {
    if (!payer.publicKey) {
      return;
    }
    const [dustAccountPk] = await PublicKey.findProgramAddress(
      [mangoGroup.publicKey.toBytes(), new Buffer('DustAccount', 'utf-8')],
      this.programId,
    );
    const instruction = makeResolveDustInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      payer.publicKey,
      dustAccountPk,
      rootBank.publicKey,
      rootBank.nodeBanks[0],
      mangoCache.publicKey,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async updateMarginBasket(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    payer: Payer,
  ) {
    const instruction = makeUpdateMarginBasketInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      mangoAccount.spotOpenOrders,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async resolveAllDust(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    mangoCache: MangoCache,
    payer: Payer,
  ) {
    if (!payer.publicKey) {
      return;
    }
    const transactionsAndSigners: {
      transaction: Transaction;
      signers: Keypair[];
    }[] = [];
    const [dustAccountPk] = await PublicKey.findProgramAddress(
      [mangoGroup.publicKey.toBytes(), new Buffer('DustAccount', 'utf-8')],
      this.programId,
    );
    for (const rootBank of mangoGroup.rootBankAccounts) {
      const transactionAndSigners: {
        transaction: Transaction;
        signers: Keypair[];
      } = {
        transaction: new Transaction(),
        signers: [],
      };
      if (rootBank) {
        const tokenIndex = mangoGroup.getRootBankIndex(rootBank?.publicKey);
        const nativeDeposit = mangoAccount.getNativeDeposit(
          rootBank,
          tokenIndex,
        );
        const nativeBorrow = mangoAccount.getNativeBorrow(rootBank, tokenIndex);
        console.log('nativeDeposit', nativeDeposit.toString());
        console.log('nativeBorrow', nativeBorrow.toString());
        console.log('tokenIndex', tokenIndex.toString());

        if (
          (nativeDeposit.gt(ZERO_I80F48) && nativeDeposit.lt(ONE_I80F48)) ||
          (nativeBorrow.gt(ZERO_I80F48) && nativeBorrow.lt(ONE_I80F48))
        ) {
          const instruction = makeResolveDustInstruction(
            this.programId,
            mangoGroup.publicKey,
            mangoAccount.publicKey,
            payer.publicKey,
            dustAccountPk,
            rootBank.publicKey,
            rootBank.nodeBanks[0],
            mangoCache.publicKey,
          );
          transactionAndSigners.transaction.add(instruction);
        }
      }
      transactionsAndSigners.push(transactionAndSigners);
    }

    const currentBlockhash = await this.getCurrentBlockhash();
    const signedTransactions = await this.signTransactions({
      transactionsAndSigners,
      payer,
      currentBlockhash,
    });

    if (signedTransactions) {
      for (const signedTransaction of signedTransactions) {
        if (signedTransaction.instructions.length == 0) {
          continue;
        }
        const txid = await this.sendSignedTransaction({
          signedTransaction,
          signedAtBlock: currentBlockhash,
        });
        console.log(txid);
      }
    } else {
      throw new Error('Unable to sign ResolveDust transactions');
    }
  }

  async emptyAndCloseMangoAccount(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    mangoCache: MangoCache,
    mngoIndex: number,
    payer: Payer,
  ): Promise<TransactionSignature[] | undefined> {
    if (!payer.publicKey) {
      return;
    }
    const transactionsAndSigners: {
      transaction: Transaction;
      signers: Keypair[];
    }[] = [];

    const redeemMngoTransaction = {
      transaction: new Transaction(),
      signers: [],
    };
    const mngoRootBank = mangoGroup.rootBankAccounts[mngoIndex] as RootBank;
    const perpMarkets = await Promise.all(
      mangoAccount.perpAccounts.map((perpAccount, i) => {
        if (perpAccount.mngoAccrued.eq(ZERO_BN)) {
          return promiseUndef();
        } else {
          return this.getPerpMarket(
            mangoGroup.perpMarkets[i].perpMarket,
            mangoGroup.tokens[i].decimals,
            mangoGroup.tokens[QUOTE_INDEX].decimals,
          );
        }
      }),
    );

    let redeemedMngo = false;
    for (let i = 0; i < mangoAccount.perpAccounts.length; i++) {
      const perpAccount = mangoAccount.perpAccounts[i];
      if (perpAccount.mngoAccrued.eq(ZERO_BN)) {
        continue;
      }
      redeemedMngo = true;
      const perpMarket = perpMarkets[i];
      // this is actually an error state; Means there is mngo accrued but PerpMarket doesn't exist
      if (perpMarket === undefined) continue;

      const instruction = makeRedeemMngoInstruction(
        this.programId,
        mangoGroup.publicKey,
        mangoGroup.mangoCache,
        mangoAccount.publicKey,
        payer.publicKey,
        perpMarket.publicKey,
        perpMarket.mngoVault,
        mngoRootBank.publicKey,
        mngoRootBank.nodeBanks[0],
        mngoRootBank.nodeBankAccounts[0].vault,
        mangoGroup.signerKey,
      );
      redeemMngoTransaction.transaction.add(instruction);
    }
    if (redeemMngoTransaction.transaction.instructions.length > 0) {
      transactionsAndSigners.push(redeemMngoTransaction);
    }

    const resolveAllDustTransaction = {
      transaction: new Transaction(),
      signers: [],
    };
    const [dustAccountPk] = await PublicKey.findProgramAddress(
      [mangoGroup.publicKey.toBytes(), new Buffer('DustAccount', 'utf-8')],
      this.programId,
    );

    for (const rootBank of mangoGroup.rootBankAccounts) {
      if (rootBank) {
        const tokenIndex = mangoGroup.getRootBankIndex(rootBank?.publicKey);
        const tokenMint = mangoGroup.tokens[tokenIndex].mint;
        const shouldWithdrawMngo = redeemedMngo && tokenIndex === mngoIndex;

        if (mangoAccount.deposits[tokenIndex].isPos() || shouldWithdrawMngo) {
          const withdrawTransaction: {
            transaction: Transaction;
            signers: Keypair[];
          } = {
            transaction: new Transaction(),
            signers: [],
          };
          let tokenAcc = await Token.getAssociatedTokenAddress(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            tokenMint,
            payer.publicKey,
          );

          let wrappedSolAccount: Keypair | null = null;
          if (tokenMint.equals(WRAPPED_SOL_MINT)) {
            wrappedSolAccount = new Keypair();
            tokenAcc = wrappedSolAccount.publicKey;
            const space = 165;
            const lamports =
              await this.connection.getMinimumBalanceForRentExemption(
                space,
                'processed',
              );
            withdrawTransaction.transaction.add(
              SystemProgram.createAccount({
                fromPubkey: payer.publicKey,
                newAccountPubkey: tokenAcc,
                lamports,
                space,
                programId: TOKEN_PROGRAM_ID,
              }),
            );
            withdrawTransaction.transaction.add(
              initializeAccount({
                account: tokenAcc,
                mint: WRAPPED_SOL_MINT,
                owner: payer.publicKey,
              }),
            );
            withdrawTransaction.signers.push(wrappedSolAccount);
          } else {
            const tokenAccExists = await this.connection.getAccountInfo(
              tokenAcc,
              'processed',
            );
            if (!tokenAccExists) {
              withdrawTransaction.transaction.add(
                Token.createAssociatedTokenAccountInstruction(
                  ASSOCIATED_TOKEN_PROGRAM_ID,
                  TOKEN_PROGRAM_ID,
                  tokenMint,
                  tokenAcc,
                  payer.publicKey,
                  payer.publicKey,
                ),
              );
            }
          }

          const instruction = makeWithdrawInstruction(
            this.programId,
            mangoGroup.publicKey,
            mangoAccount.publicKey,
            payer.publicKey,
            mangoGroup.mangoCache,
            rootBank.publicKey,
            rootBank.nodeBanks[0],
            rootBank.nodeBankAccounts[0].vault,
            tokenAcc,
            mangoGroup.signerKey,
            mangoAccount.spotOpenOrders,
            U64_MAX_BN,
            false,
          );
          withdrawTransaction.transaction.add(instruction);

          if (wrappedSolAccount) {
            withdrawTransaction.transaction.add(
              closeAccount({
                source: wrappedSolAccount.publicKey,
                destination: payer.publicKey,
                owner: payer.publicKey,
              }),
            );
          }
          transactionsAndSigners.push(withdrawTransaction);
        }

        const nativeBorrow = mangoAccount.getNativeBorrow(
          mangoCache.rootBankCache[tokenIndex],
          tokenIndex,
        );

        if (
          shouldWithdrawMngo ||
          mangoAccount.deposits[tokenIndex].isPos() ||
          (nativeBorrow.gt(ZERO_I80F48) && nativeBorrow.lt(ONE_I80F48))
        ) {
          const instruction = makeResolveDustInstruction(
            this.programId,
            mangoGroup.publicKey,
            mangoAccount.publicKey,
            payer.publicKey,
            dustAccountPk,
            rootBank.publicKey,
            rootBank.nodeBanks[0],
            mangoCache.publicKey,
          );
          resolveAllDustTransaction.transaction.add(instruction);
        }
      }
    }

    transactionsAndSigners.push(resolveAllDustTransaction);

    const closeAccountsTransaction = {
      transaction: new Transaction(),
      signers: [],
    };
    for (let i = 0; i < mangoAccount.spotOpenOrders.length; i++) {
      const openOrders = mangoAccount.spotOpenOrders[i];
      const spotMarket = mangoGroup.spotMarkets[i].spotMarket;
      if (!openOrders.equals(zeroKey)) {
        closeAccountsTransaction.transaction.add(
          makeCloseSpotOpenOrdersInstruction(
            this.programId,
            mangoGroup.publicKey,
            mangoAccount.publicKey,
            payer.publicKey,
            mangoGroup.dexProgramId,
            openOrders,
            spotMarket,
            mangoGroup.signerKey,
          ),
        );
      }
    }
    if (!mangoAccount.advancedOrdersKey.equals(zeroKey)) {
      closeAccountsTransaction.transaction.add(
        makeCloseAdvancedOrdersInstruction(
          this.programId,
          mangoGroup.publicKey,
          mangoAccount.publicKey,
          payer.publicKey,
          mangoAccount.advancedOrdersKey,
        ),
      );
    }

    if (mangoAccount.metaData.version == 0) {
      closeAccountsTransaction.transaction.add(
        makeUpgradeMangoAccountV0V1Instruction(
          this.programId,
          mangoGroup.publicKey,
          mangoAccount.publicKey,
          payer.publicKey,
        ),
      );
    }

    closeAccountsTransaction.transaction.add(
      makeCloseMangoAccountInstruction(
        this.programId,
        mangoGroup.publicKey,
        mangoAccount.publicKey,
        payer.publicKey,
      ),
    );
    transactionsAndSigners.push(closeAccountsTransaction);
    const currentBlockhash = await this.getCurrentBlockhash();
    const signedTransactions = await this.signTransactions({
      transactionsAndSigners,
      payer,
      currentBlockhash,
    });

    const txids: TransactionSignature[] = [];
    if (signedTransactions) {
      for (const signedTransaction of signedTransactions) {
        if (signedTransaction.instructions.length == 0) {
          continue;
        }
        const txid = await this.sendSignedTransaction({
          signedTransaction,
          signedAtBlock: currentBlockhash,
        });
        txids.push(txid);
        console.log(txid);
      }
    } else {
      throw new Error('Unable to sign emptyAndCloseMangoAccount transactions');
    }

    return txids;
  }

  async cancelPerpOrderSide(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    perpMarket: PerpMarket,
    payer: Payer,
    side: 'buy' | 'sell',
    limit: number,
  ) {
    if (!payer.publicKey) {
      return;
    }
    const instruction = makeCancelPerpOrdersSideInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      payer.publicKey,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      side,
      new BN(limit),
    );

    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async setDelegate(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    payer: Payer,
    delegate: PublicKey,
  ) {
    if (!payer.publicKey) {
      return;
    }
    const instruction = makeSetDelegateInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      payer.publicKey,
      delegate,
    );

    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async changeSpotMarketParams(
    mangoGroup: MangoGroup,
    spotMarket: Market,
    rootBank: RootBank,
    admin: Payer,

    maintLeverage: number | undefined,
    initLeverage: number | undefined,
    liquidationFee: number | undefined,
    optimalUtil: number | undefined,
    optimalRate: number | undefined,
    maxRate: number | undefined,
    version: number | undefined,
  ): Promise<TransactionSignature | undefined> {
    if (!admin.publicKey) {
      return;
    }
    const instruction = makeChangeSpotMarketParamsInstruction(
      this.programId,
      mangoGroup.publicKey,
      spotMarket.publicKey,
      rootBank.publicKey,
      admin.publicKey,
      I80F48.fromNumberOrUndef(maintLeverage),
      I80F48.fromNumberOrUndef(initLeverage),
      I80F48.fromNumberOrUndef(liquidationFee),
      I80F48.fromNumberOrUndef(optimalUtil),
      I80F48.fromNumberOrUndef(optimalRate),
      I80F48.fromNumberOrUndef(maxRate),
      version !== undefined ? new BN(version) : undefined,
    );

    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];

    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  /**
   * Change the referral fee params
   * @param mangoGroup
   * @param admin
   * @param refSurcharge normal units 0.0001 -> 1 basis point
   * @param refShare
   * @param refMngoRequired ui units -> 1 -> 1_000_000 MNGO
   */
  async changeReferralFeeParams(
    mangoGroup: MangoGroup,
    admin: Payer,
    refSurcharge: number,
    refShare: number,
    refMngoRequired: number,
  ): Promise<TransactionSignature | undefined> {
    if (!admin.publicKey) {
      return;
    }
    const instruction = makeChangeReferralFeeParamsInstruction(
      this.programId,
      mangoGroup.publicKey,
      admin.publicKey,
      new BN(refSurcharge * CENTIBPS_PER_UNIT),
      new BN(refShare * CENTIBPS_PER_UNIT),
      new BN(refMngoRequired * 1_000_000),
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  async setReferrerMemory(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    payer: Payer, // must be also owner of mangoAccount
    referrerMangoAccountPk: PublicKey,
  ): Promise<TransactionSignature | undefined> {
    if (!payer.publicKey) {
      return;
    }
    // Generate the PDA pubkey
    const [referrerMemoryPk] = await PublicKey.findProgramAddress(
      [mangoAccount.publicKey.toBytes(), new Buffer('ReferrerMemory', 'utf-8')],
      this.programId,
    );

    const instruction = makeSetReferrerMemoryInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      payer.publicKey,
      referrerMemoryPk,
      referrerMangoAccountPk,
      payer.publicKey,
    );

    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async getReferrerPda(
    mangoGroup: MangoGroup,
    referrerId: string,
  ): Promise<{ referrerPda: PublicKey; encodedReferrerId: Buffer }> {
    const encoded = Buffer.from(referrerId, 'utf8');
    if (encoded.length > INFO_LEN) {
      throw new Error(
        `info string too long. Must be less than or equal to ${INFO_LEN} bytes`,
      );
    }

    const encodedReferrerId = Buffer.concat([
      encoded,
      Buffer.alloc(INFO_LEN - encoded.length, 0),
    ]);

    // Generate the PDA pubkey
    const [referrerIdRecordPk] = await PublicKey.findProgramAddress(
      [
        mangoGroup.publicKey.toBytes(),
        new Buffer('ReferrerIdRecord', 'utf-8'),
        encodedReferrerId,
      ],
      this.programId,
    );

    return { referrerPda: referrerIdRecordPk, encodedReferrerId };
  }

  async registerReferrerId(
    mangoGroup: MangoGroup,
    referrerMangoAccount: MangoAccount,
    payer: Payer, // will also owner of referrerMangoAccount
    referrerId: string,
  ): Promise<TransactionSignature | undefined> {
    if (!payer.publicKey) {
      return;
    }
    const { referrerPda, encodedReferrerId } = await this.getReferrerPda(
      mangoGroup,
      referrerId,
    );

    const instruction = makeRegisterReferrerIdInstruction(
      this.programId,
      mangoGroup.publicKey,
      referrerMangoAccount.publicKey,
      referrerPda,
      payer.publicKey,
      encodedReferrerId,
    );

    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async getReferrerIdsForMangoAccount(
    mangoAccount: MangoAccount,
  ): Promise<ReferrerIdRecord[]> {
    const filters = [
      {
        memcmp: {
          offset: ReferrerIdRecordLayout.offsetOf('referrerMangoAccount'),
          bytes: mangoAccount.publicKey.toBase58(),
        },
      },
      {
        dataSize: ReferrerIdRecordLayout.span,
      },
    ];

    const referrerIds = await getFilteredProgramAccounts(
      this.connection,
      this.programId,
      filters,
    ).then((referrerIds) => {
      return referrerIds.map(({ accountInfo }) => {
        return new ReferrerIdRecord(
          ReferrerIdRecordLayout.decode(
            accountInfo == null ? undefined : accountInfo.data,
          ),
        );
      });
    });

    return referrerIds;
  }

  async cancelAllSpotOrders(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    spotMarket: Market,
    owner: Payer,
    limit: number,
  ) {
    if(!owner.publicKey)
      return;
    const marketIndex = mangoGroup.getSpotMarketIndex(spotMarket.address);
    const baseRootBank = mangoGroup.rootBankAccounts[marketIndex];
    const quoteRootBank = mangoGroup.rootBankAccounts[QUOTE_INDEX];
    if(baseRootBank == null || quoteRootBank == null)
    {
      console.log("A root bank is null")
      return;
    }
    const baseNodeBanks = await baseRootBank.loadNodeBanks(this.connection);
    const quoteNodeBanks = await quoteRootBank.loadNodeBanks(this.connection);
    const spotMarketIndex = mangoGroup.getSpotMarketIndex(spotMarket.publicKey);

    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId,
    );

    const instruction = makeCancelAllSpotOrdersInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      mangoAccount.publicKey,
      owner.publicKey,
      baseRootBank.publicKey,
      baseNodeBanks[0].publicKey,
      baseNodeBanks[0].vault,
      quoteRootBank.publicKey,
      quoteNodeBanks[0].publicKey,
      quoteNodeBanks[0].vault,
      spotMarket.publicKey,
      spotMarket.bidsAddress,
      spotMarket.asksAddress,
      mangoAccount.spotOpenOrders[spotMarketIndex],
      mangoGroup.signerKey,
      spotMarket['_decoded'].eventQueue,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      dexSigner,
      mangoGroup.dexProgramId,
      new BN(limit),
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, owner, []);
  }
}
