import {
  Account,
  AccountInfo,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SimulatedTransactionResponse,
  SystemProgram,
  Transaction,
  TransactionConfirmationStatus,
  TransactionSignature,
} from '@solana/web3.js';
import BN from 'bn.js';
import {
  awaitTransactionSignatureConfirmation,
  createAccountInstruction,
  createSignerKeyAndNonce,
  createTokenAccountInstructions,
  getFilteredProgramAccounts,
  getMultipleAccounts,
  nativeToUi,
  simulateTransaction,
  sleep,
  uiToNative,
  zeroKey,
  ZERO_BN,
} from './utils';
import {
  AssetType,
  BookSideLayout,
  MangoAccountLayout,
  MangoCache,
  MangoCacheLayout,
  MangoGroupLayout,
  MAX_NUM_IN_MARGIN_BASKET,
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
  makeCancelPerpOrderInstruction,
  makeCancelSpotOrderInstruction,
  makeChangePerpMarketParamsInstruction,
  makeConsumeEventsInstruction,
  makeDepositInstruction,
  makeDepositMsrmInstruction,
  makeForceCancelPerpOrdersInstruction,
  makeForceCancelSpotOrdersInstruction,
  makeInitMangoAccountInstruction,
  makeInitMangoGroupInstruction,
  makeInitSpotOpenOrdersInstruction,
  makeLiquidatePerpMarketInstruction,
  makeLiquidateTokenAndPerpInstruction,
  makeLiquidateTokenAndTokenInstruction,
  makePlacePerpOrderInstruction,
  makePlaceSpotOrderInstruction,
  makeRedeemMngoInstruction,
  makeResolvePerpBankruptcyInstruction,
  makeResolveTokenBankruptcyInstruction,
  makeSetGroupAdminInstruction,
  makeSetOracleInstruction,
  makeSettleFeesInstruction,
  makeSettleFundsInstruction,
  makeSettlePnlInstruction,
  makeUpdateFundingInstruction,
  makeUpdateRootBankInstruction,
  makeWithdrawInstruction,
  makeWithdrawMsrmInstruction,
  makeExecutePerpTriggerOrderInstruction,
  makeInitAdvancedOrdersInstruction,
  makePlaceSpotOrder2Instruction,
  makeRemoveAdvancedOrderInstruction,
  makeCreatePerpMarketInstruction,
} from './instruction';
import {
  getFeeRates,
  getFeeTier,
  Market,
  OpenOrders,
} from '@project-serum/serum';
import { I80F48, ZERO_I80F48 } from './fixednum';
import { Order } from '@project-serum/serum/lib/market';

import { PerpOrderType, WalletAdapter } from './types';
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

export const getUnixTs = () => {
  return new Date().getTime() / 1000;
};

export class MangoClient {
  connection: Connection;
  programId: PublicKey;

  constructor(connection: Connection, programId: PublicKey) {
    this.connection = connection;
    this.programId = programId;
  }

  async sendTransactions(
    transactions: Transaction[],
    payer: Account | WalletAdapter,
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

  async signTransaction({ transaction, payer, signers }) {
    transaction.recentBlockhash = (
      await this.connection.getRecentBlockhash()
    ).blockhash;
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
  }: {
    transactionsAndSigners: {
      transaction: Transaction;
      signers?: Array<Account>;
    }[];
    payer: Account | WalletAdapter;
  }) {
    const blockhash = (await this.connection.getRecentBlockhash('max'))
      .blockhash;
    transactionsAndSigners.forEach(({ transaction, signers = [] }) => {
      transaction.recentBlockhash = blockhash;
      transaction.setSigners(
        payer.publicKey,
        ...signers.map((s) => s.publicKey),
      );
      if (signers?.length > 0) {
        transaction.partialSign(...signers);
      }
    });
    if (!(payer instanceof Account)) {
      return await payer.signAllTransactions(
        transactionsAndSigners.map(({ transaction }) => transaction),
      );
    } else {
      transactionsAndSigners.forEach(({ transaction, signers }) => {
        // @ts-ignore
        transaction.sign(...[payer].concat(signers));
      });
    }
  }

  // TODO - switch Account to Keypair and switch off setSigners due to deprecated
  async sendTransaction(
    transaction: Transaction,
    payer: Account | WalletAdapter | Keypair,
    additionalSigners: Account[],
    timeout = 30000,
    confirmLevel: TransactionConfirmationStatus = 'processed',
    postSignTxCallback?: any,
  ): Promise<TransactionSignature> {
    await this.signTransaction({
      transaction,
      payer,
      signers: additionalSigners,
    });

    const rawTransaction = transaction.serialize();
    const startTime = getUnixTs();
    if (postSignTxCallback) {
      try {
        postSignTxCallback();
      } catch (e) {
        console.log(`postSignTxCallback error ${e}`);
      }
    }
    const txid: TransactionSignature = await this.connection.sendRawTransaction(
      rawTransaction,
      { skipPreflight: true },
    );

    console.log(
      'Started awaiting confirmation for',
      txid,
      'size:',
      rawTransaction.length,
    );

    let done = false;
    (async () => {
      // TODO - make sure this works well on mainnet
      await sleep(1000);
      while (!done && getUnixTs() - startTime < timeout / 1000) {
        console.log(new Date().toUTCString(), ' sending tx ', txid);
        this.connection.sendRawTransaction(rawTransaction, {
          skipPreflight: true,
        });
        await sleep(2000);
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

    // console.log('Latency', txid, getUnixTs() - startTime);
    return txid;
  }

  async sendSignedTransaction({
    signedTransaction,
    timeout = 30000,
    confirmLevel = 'processed',
  }: {
    signedTransaction: Transaction;
    timeout?: number;
    confirmLevel?: TransactionConfirmationStatus;
  }): Promise<string> {
    const rawTransaction = signedTransaction.serialize();
    const startTime = getUnixTs();

    const txid: TransactionSignature = await this.connection.sendRawTransaction(
      rawTransaction,
      {
        skipPreflight: true,
      },
    );

    // console.log('Started awaiting confirmation for', txid);

    let done = false;
    (async () => {
      await sleep(500);
      while (!done && getUnixTs() - startTime < timeout) {
        this.connection.sendRawTransaction(rawTransaction, {
          skipPreflight: true,
        });
        await sleep(500);
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

    // console.log('Latency', txid, getUnixTs() - startTime);
    return txid;
  }

  async initMangoGroup(
    quoteMint: PublicKey,
    msrmMint: PublicKey,
    dexProgram: PublicKey,
    feesVault: PublicKey, // owned by Mango DAO token governance
    validInterval: number,
    quoteOptimalUtil: number,
    quoteOptimalRate: number,
    quoteMaxRate: number,
    payer: Account | WalletAdapter,
  ): Promise<PublicKey> {
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
    const quoteVaultAccount = new Account();

    const quoteVaultAccountInstructions = await createTokenAccountInstructions(
      this.connection,
      payer.publicKey,
      quoteVaultAccount.publicKey,
      quoteMint,
      signerKey,
    );

    const insuranceVaultAccount = new Account();
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
      const msrmVaultAccount = new Account();
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

  async getMangoGroup(mangoGroup: PublicKey): Promise<MangoGroup> {
    const accountInfo = await this.connection.getAccountInfo(mangoGroup);
    const decoded = MangoGroupLayout.decode(
      accountInfo == null ? undefined : accountInfo.data,
    );

    return new MangoGroup(mangoGroup, decoded);
  }

  async initMangoAccount(
    mangoGroup: MangoGroup,
    owner: Account | WalletAdapter,
  ): Promise<PublicKey> {
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

  async initMangoAccountAndDeposit(
    mangoGroup: MangoGroup,
    owner: Account | WalletAdapter,
    rootBank: PublicKey,
    nodeBank: PublicKey,
    vault: PublicKey,
    tokenAcc: PublicKey,

    quantity: number,
    info?: string,
  ): Promise<string> {
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

    let wrappedSolAccount: Account | null = null;
    if (
      tokenMint.equals(WRAPPED_SOL_MINT) &&
      tokenAcc.toBase58() === owner.publicKey.toBase58()
    ) {
      wrappedSolAccount = new Account();
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

  async deposit(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Account | WalletAdapter,
    rootBank: PublicKey,
    nodeBank: PublicKey,
    vault: PublicKey,
    tokenAcc: PublicKey,

    quantity: number,
  ): Promise<TransactionSignature> {
    const transaction = new Transaction();
    const additionalSigners: Array<Account> = [];
    const tokenIndex = mangoGroup.getRootBankIndex(rootBank);
    const tokenMint = mangoGroup.tokens[tokenIndex].mint;

    let wrappedSolAccount: Account | null = null;
    if (
      tokenMint.equals(WRAPPED_SOL_MINT) &&
      tokenAcc.toBase58() === owner.publicKey.toBase58()
    ) {
      wrappedSolAccount = new Account();
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

  async withdraw(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Account | WalletAdapter,
    rootBank: PublicKey,
    nodeBank: PublicKey,
    vault: PublicKey,

    quantity: number,
    allowBorrow: boolean,
  ): Promise<TransactionSignature> {
    const transaction = new Transaction();
    const additionalSigners: Account[] = [];
    const tokenIndex = mangoGroup.getRootBankIndex(rootBank);
    const tokenMint = mangoGroup.tokens[tokenIndex].mint;

    let tokenAcc = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      tokenMint,
      owner.publicKey,
    );

    let wrappedSolAccount: Account | null = null;
    if (tokenMint.equals(WRAPPED_SOL_MINT)) {
      wrappedSolAccount = new Account();
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
      const tokenAccExists = await this.connection.getAccountInfo(
        tokenAcc,
        'recent',
      );
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

  // Keeper functions
  async cacheRootBanks(
    mangoGroup: PublicKey,
    mangoCache: PublicKey,
    rootBanks: PublicKey[],
    payer: Account | WalletAdapter,
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

  async cachePrices(
    mangoGroup: PublicKey,
    mangoCache: PublicKey,
    oracles: PublicKey[],
    payer: Account | WalletAdapter,
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

  async cachePerpMarkets(
    mangoGroup: PublicKey,
    mangoCache: PublicKey,
    perpMarkets: PublicKey[],
    payer: Account,
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

  async updateRootBank(
    mangoGroup: MangoGroup,
    rootBank: PublicKey,
    nodeBanks: PublicKey[],
    payer: Account | WalletAdapter,
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

  async consumeEvents(
    mangoGroup: MangoGroup,
    perpMarket: PerpMarket,
    mangoAccounts: PublicKey[],
    payer: Account,
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

    return await this.sendTransaction(transaction, payer, []);
  }

  async updateFunding(
    mangoGroup: PublicKey,
    mangoCache: PublicKey,
    perpMarket: PublicKey,
    bids: PublicKey,
    asks: PublicKey,
    payer: Account,
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
  async placePerpOrder(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    mangoCache: PublicKey, // TODO - remove; already in MangoGroup
    perpMarket: PerpMarket,
    owner: Account | WalletAdapter,

    side: 'buy' | 'sell',
    price: number,
    quantity: number,
    orderType?: PerpOrderType,
    clientOrderId = 0,
    bookSideInfo?: AccountInfo<Buffer>, // ask if side === bid, bids if side === ask; if this is given; crank instruction is added
    reduceOnly?: boolean,
  ): Promise<TransactionSignature> {
    const [nativePrice, nativeQuantity] = perpMarket.uiToNativePriceQuantity(
      price,
      quantity,
    );
    const transaction = new Transaction();
    const additionalSigners: Account[] = [];

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
    );
    transaction.add(instruction);

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
  async cancelPerpOrder(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Account | WalletAdapter,
    perpMarket: PerpMarket,
    order: PerpOrder,
    invalidIdOk = false, // Don't throw error if order is invalid
  ): Promise<TransactionSignature> {
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

  /*
  async loadPerpMarkets(perpMarkets: PublicKey[]): Promise<PerpMarket[]> {
    const accounts = await Promise.all(
      perpMarkets.map((pk) => this.connection.getAccountInfo(pk)),
    );

    const parsedPerpMarkets: PerpMarket[] = [];

    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      if (acc) {
        const decoded = PerpMarketLayout.decode(acc.data);
        parsedPerpMarkets.push(new PerpMarket(perpMarkets[i], decoded));
      }
    }

    return parsedPerpMarkets;
  }
  */

  async addOracle(
    mangoGroup: MangoGroup,
    oracle: PublicKey,
    admin: Account,
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

  async setOracle(
    mangoGroup: MangoGroup,
    oracle: PublicKey,
    admin: Account,
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
    admin: Account,

    maintLeverage: number,
    initLeverage: number,
    liquidationFee: number,
    optimalUtil: number,
    optimalRate: number,
    maxRate: number,
  ): Promise<TransactionSignature> {
    const vaultAccount = new Account();

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
    owner: Account | WalletAdapter,

    side: 'buy' | 'sell',
    price: number,
    size: number,
    orderType?: 'limit' | 'ioc' | 'postOnly',
    clientId?: BN,
  ): Promise<TransactionSignature> {
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
    const additionalSigners: Account[] = [];
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
    owner: Account | WalletAdapter,

    side: 'buy' | 'sell',
    price: number,
    size: number,
    orderType?: 'limit' | 'ioc' | 'postOnly',
    clientOrderId?: BN,
    useMsrmVault?: boolean | undefined,
  ): Promise<TransactionSignature> {
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

    const spotMarketIndex = mangoGroup.getSpotMarketIndex(spotMarket.publicKey);

    if (!mangoGroup.rootBankAccounts.filter((a) => !!a).length) {
      await mangoGroup.loadRootBanks(this.connection);
    }
    let feeVault: PublicKey = zeroKey;
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
    const additionalSigners: Account[] = [];
    const openOrdersKeys: { pubkey: PublicKey; isWritable: boolean }[] = [];

    // Only pass in open orders if in margin basket or current market index, and
    // the only writable account should be OpenOrders for current market index
    let marketOpenOrdersKey = zeroKey;
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

    const txid = await this.sendTransaction(
      transaction,
      owner,
      additionalSigners,
    );

    // update MangoAccount to have new OpenOrders pubkey
    // We know this new key is in margin basket because if it was a full taker trade
    // there is some leftover from fee rebate. If maker trade there's the order.
    // and if it failed then we already exited before this line
    mangoAccount.spotOpenOrders[spotMarketIndex] = marketOpenOrdersKey;
    mangoAccount.inMarginBasket[spotMarketIndex] = true;
    console.log(
      spotMarketIndex,
      mangoAccount.spotOpenOrders[spotMarketIndex].toBase58(),
      marketOpenOrdersKey.toBase58(),
    );

    return txid;
  }

  async cancelSpotOrder(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Account | WalletAdapter,
    spotMarket: Market,
    order: Order,
  ): Promise<TransactionSignature> {
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
    owner: Account | WalletAdapter,
    spotMarket: Market,
  ): Promise<TransactionSignature> {
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

  async settleAll(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    spotMarkets: Market[],
    owner: Account | WalletAdapter,
  ) {
    const transactions: Transaction[] = [];

    for (let i = 0; i < spotMarkets.length; i++) {
      const transaction = new Transaction();
      const openOrdersAccount = mangoAccount.spotOpenOrdersAccounts[i];
      if (openOrdersAccount === undefined) {
        continue;
      } else if (
        openOrdersAccount.quoteTokenFree.toNumber() +
          openOrdersAccount['referrerRebatesAccrued'].toNumber() ===
          0 &&
        openOrdersAccount.baseTokenFree.toNumber() === 0
      ) {
        continue;
      }

      const spotMarket = spotMarkets[i];
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

    const signedTransactions = await this.signTransactions({
      transactionsAndSigners,
      payer: owner,
    });

    if (signedTransactions) {
      for (const signedTransaction of signedTransactions) {
        if (signedTransaction.instructions.length == 0) {
          continue;
        }
        await this.sendSignedTransaction({
          signedTransaction,
        });
      }
    } else {
      throw new Error('Unable to sign Settle All transaction');
    }
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
    owner: Account | WalletAdapter,
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
    const additionalSigners: Account[] = [];

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

    const mangoAccounts = await this.getAllMangoAccounts(mangoGroup, [], false);

    const accountsWithPnl = mangoAccounts
      .map((m) => ({
        account: m,
        pnl: m.perpAccounts[marketIndex].getPnl(
          perpMarketInfo,
          mangoCache.perpMarketCache[marketIndex],
          price,
        ),
      }))
      .sort((a, b) => sign * a.pnl.cmp(b.pnl));

    for (const account of accountsWithPnl) {
      // ignore own account explicitly
      if (account.account.publicKey.equals(mangoAccount.publicKey)) {
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
          account.account.publicKey,
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

  async addStubOracle(mangoGroupPk: PublicKey, admin: Account) {
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
    admin: Account,
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
    admin: Account,
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

    const mngoVaultAccount = new Account();
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
    admin: Account | Keypair,
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
  ) {
    const [perpMarketPk] = await PublicKey.findProgramAddress(
      [
        mangoGroup.publicKey.toBytes(),
        new Buffer('PerpMarket', 'utf-8'),
        oraclePk.toBytes(),
      ],
      this.programId,
    );

    const [bidsPk] = await PublicKey.findProgramAddress(
      [perpMarketPk.toBytes(), new Buffer('Bids', 'utf-8')],
      this.programId,
    );
    const [asksPk] = await PublicKey.findProgramAddress(
      [perpMarketPk.toBytes(), new Buffer('Asks', 'utf-8')],
      this.programId,
    );
    const [eventQueuePk] = await PublicKey.findProgramAddress(
      [perpMarketPk.toBytes(), new Buffer('EventQueue', 'utf-8')],
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
    const transaction = new Transaction();
    const instruction = await makeCreatePerpMarketInstruction(
      this.programId,
      mangoGroup.publicKey,
      oraclePk,
      perpMarketPk,
      eventQueuePk,
      bidsPk,
      asksPk,
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
      new BN(maxNumEvents),
      I80F48.fromNumber(rate),
      I80F48.fromNumber(maxDepthBps),
      new BN(targetPeriodLength),
      new BN(mngoPerPeriod),
      new BN(exp),
      new BN(version),
    );

    const additionalSigners = [];
    transaction.add(instruction);
    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  // Liquidator Functions
  async forceCancelSpotOrders(
    mangoGroup: MangoGroup,
    liqeeMangoAccount: MangoAccount,
    spotMarket: Market,
    baseRootBank: RootBank,
    quoteRootBank: RootBank,
    payer: Account,
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
    payer: Account | WalletAdapter,
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
    payer: Account,
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
    payer: Account,
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
      liqeeMangoAccount.spotOpenOrders,
      liqorMangoAccount.spotOpenOrders,
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
    payer: Account,
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
      liqeeMangoAccount.spotOpenOrders,
      liqorMangoAccount.spotOpenOrders,
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
    payer: Account,
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
      liqeeMangoAccount.spotOpenOrders,
      liqorMangoAccount.spotOpenOrders,
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
    payer: Account,
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
    payer: Account,
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
    payer: Account,
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
    payer: Account | WalletAdapter,
    mngoRootBank: PublicKey,
    mngoNodeBank: PublicKey,
    mngoVault: PublicKey,
  ): Promise<TransactionSignature> {
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
    payer: Account | WalletAdapter,
    mngoRootBank: PublicKey,
    mngoNodeBank: PublicKey,
    mngoVault: PublicKey,
  ): Promise<TransactionSignature> {
    const transaction = new Transaction();

    for (let i = 0; i < mangoAccount.perpAccounts.length; i++) {
      const perpAccount = mangoAccount.perpAccounts[i];
      if (perpAccount.mngoAccrued.eq(ZERO_BN)) {
        continue;
      }
      const perpMarketInfo = mangoGroup.perpMarkets[i];
      const perpMarket = await this.getPerpMarket(
        perpMarketInfo.perpMarket,
        mangoGroup.tokens[i].decimals,
        mangoGroup.tokens[QUOTE_INDEX].decimals,
      );

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
    }

    return await this.sendTransaction(transaction, payer, []);
  }

  async addMangoAccountInfo(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Account | WalletAdapter,
    info: string,
  ): Promise<TransactionSignature> {
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
    owner: Account | WalletAdapter,
    msrmAccount: PublicKey,
    quantity: number,
  ): Promise<TransactionSignature> {
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
    owner: Account | WalletAdapter,
    msrmAccount: PublicKey,
    quantity: number,
  ): Promise<TransactionSignature> {
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
    admin: Account | WalletAdapter,

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
  ): Promise<TransactionSignature> {
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

  async setGroupAdmin(
    mangoGroup: MangoGroup,
    newAdmin: PublicKey,
    admin: Account | WalletAdapter,
  ): Promise<TransactionSignature> {
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
    owner: Account | WalletAdapter,
    order: Order,

    side: 'buy' | 'sell',
    price: number,
    size: number,
    orderType?: 'limit' | 'ioc' | 'postOnly',
  ): Promise<TransactionSignature> {
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

    const additionalSigners: Account[] = [];

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
    owner: Account | WalletAdapter,
    order: PerpOrder,

    side: 'buy' | 'sell',
    price: number,
    quantity: number,
    orderType?: PerpOrderType,
    clientOrderId?: number,
    bookSideInfo?: AccountInfo<Buffer>, // ask if side === bid, bids if side === ask; if this is given; crank instruction is added
    invalidIdOk = false, // Don't throw error if order is invalid
  ): Promise<TransactionSignature> {
    const transaction = new Transaction();
    const additionalSigners: Account[] = [];

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
    owner: Account | WalletAdapter,
    orderType: PerpOrderType,
    side: 'buy' | 'sell',
    price: number,
    quantity: number,
    triggerCondition: 'above' | 'below',
    triggerPrice: number,
    reduceOnly: boolean,
    clientOrderId?: number,
  ): Promise<TransactionSignature> {
    const transaction = new Transaction();
    const additionalSigners: Account[] = [];

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
    owner: Account | WalletAdapter,
    orderIndex: number,
  ): Promise<TransactionSignature> {
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
    payer: Account | WalletAdapter,
    orderIndex: number,
  ): Promise<TransactionSignature> {
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
}
