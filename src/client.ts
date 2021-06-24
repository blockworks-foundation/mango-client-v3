import {
  Account,
  Connection,
  // Keypair,
  PublicKey,
  SimulatedTransactionResponse,
  Transaction,
  TransactionConfirmationStatus,
  TransactionSignature,
  // AccountInfo,
} from '@solana/web3.js';
import BN from 'bn.js';
import {
  awaitTransactionSignatureConfirmation,
  simulateTransaction,
  sleep,
  createAccountInstruction,
  createSignerKeyAndNonce,
  createTokenAccountInstructions,
  nativeToUi,
  uiToNative,
  zeroKey,
  getFilteredProgramAccounts,
} from './utils';
import {
  MangoGroupLayout,
  NodeBankLayout,
  RootBankLayout,
  MangoCacheLayout,
  MangoAccountLayout,
  StubOracleLayout,
  PerpMarketLayout,
  BookSideLayout,
  PerpEventQueueLayout,
  PerpEventLayout,
  EventQueue,
  EventQueueLayout,
  MAX_TOKENS,
} from './layout';
import MangoGroup, { QUOTE_INDEX } from './MangoGroup';
import MangoAccount from './MangoAccount';
import PerpMarket from './PerpMarket';
import RootBank from './RootBank';
import {
  makeAddOracleInstruction,
  makeAddPerpMarketInstruction,
  makeAddSpotMarketInstruction,
  makeCachePerpMarketsInstruction,
  makeCachePricesInstruction,
  makeCacheRootBankInstruction,
  makeConsumeEventsInstruction,
  makeCancelSpotOrderInstruction,
  makeDepositInstruction,
  makeInitMangoAccountInstruction,
  makeInitMangoGroupInstruction,
  makePlacePerpOrderInstruction,
  makePlaceSpotOrderInstruction,
  makeSetOracleInstruction,
  makeSettleFundsInstruction,
  makeSettlePnlInstruction,
  makeUpdateFundingInstruction,
  makeUpdateRootBankInstruction,
  makeWithdrawInstruction,
  makeCancelPerpOrderInstruction,
} from './instruction';
import {
  Market,
  getFeeRates,
  getFeeTier,
  OpenOrders,
} from '@project-serum/serum';
import { I80F48, ZERO_I80F48 } from './fixednum';
import { Order } from '@project-serum/serum/lib/market';

import { WalletAdapter } from './types';
import { PerpOrder } from './book';

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

  // TODO - switch Account to Keypair and switch off setSigners due to deprecated
  async sendTransaction(
    transaction: Transaction,
    payer: Account | WalletAdapter,
    additionalSigners: Account[],
    timeout = 30000,
    confirmLevel: TransactionConfirmationStatus = 'processed',
  ): Promise<TransactionSignature> {
    await this.signTransaction({
      transaction,
      payer,
      signers: additionalSigners,
    });

    const rawTransaction = transaction.serialize();
    const startTime = getUnixTs();
    const txid: TransactionSignature = await this.connection.sendRawTransaction(
      rawTransaction,
      { skipPreflight: true },
    );
    console.log('Started awaiting confirmation for', txid);

    let done = false;
    (async () => {
      // TODO - make sure this works well on mainnet
      await sleep(2000);
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
          await simulateTransaction(
            this.connection,
            transaction,
            'singleGossip',
          )
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

    console.log('Latency', txid, getUnixTs() - startTime);
    return txid;
  }

  async initMangoGroup(
    quoteMint: PublicKey,
    dexProgram: PublicKey,
    validInterval: number,
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

    const initMangoGroupInstruction = makeInitMangoGroupInstruction(
      this.programId,
      accountInstruction.account.publicKey,
      signerKey,
      payer.publicKey,
      quoteMint,
      quoteVaultAccount.publicKey,
      quoteNodeBankAccountInstruction.account.publicKey,
      quoteRootBankAccountInstruction.account.publicKey,
      cacheAccountInstruction.account.publicKey,
      dexProgram,
      new BN(signerNonce),
      new BN(validInterval),
    );

    const transaction = new Transaction();
    transaction.add(accountInstruction.instruction);
    transaction.add(...quoteVaultAccountInstructions);
    transaction.add(quoteNodeBankAccountInstruction.instruction);
    transaction.add(quoteRootBankAccountInstruction.instruction);
    transaction.add(cacheAccountInstruction.instruction);
    transaction.add(initMangoGroupInstruction);

    await this.sendTransaction(transaction, payer, [
      accountInstruction.account,
      quoteVaultAccount,
      quoteNodeBankAccountInstruction.account,
      quoteRootBankAccountInstruction.account,
      cacheAccountInstruction.account,
    ]);

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
      'singleGossip',
    );
    const mangoAccount = new MangoAccount(
      mangoAccountPk,
      MangoAccountLayout.decode(acc == null ? undefined : acc.data),
    );
    await mangoAccount.loadOpenOrders(this.connection, dexProgramId);
    return mangoAccount;
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
    const tokenIndex = mangoGroup.getRootBankIndex(rootBank);
    const nativeQuantity = uiToNative(
      quantity,
      mangoGroup.tokens[tokenIndex].decimals,
    );

    const transaction = new Transaction();

    const instruction = makeDepositInstruction(
      this.programId,
      mangoGroup.publicKey,
      owner.publicKey,
      mangoGroup.mangoCache,
      mangoAccount.publicKey,
      rootBank,
      nodeBank,
      vault,
      tokenAcc,
      nativeQuantity,
    );

    transaction.add(instruction);

    const additionalSigners = [];
    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async withdraw(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Account | WalletAdapter,
    rootBank: PublicKey,
    nodeBank: PublicKey,
    vault: PublicKey,
    tokenAcc: PublicKey,

    quantity: number,
    allowBorrow: boolean,
  ): Promise<TransactionSignature> {
    const tokenIndex = mangoGroup.getRootBankIndex(rootBank);
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

    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];

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
    mangoGroup: PublicKey,
    rootBank: PublicKey,
    nodeBanks: PublicKey[],
    payer: Account | WalletAdapter,
  ): Promise<TransactionSignature> {
    const updateRootBanksInstruction = makeUpdateRootBankInstruction(
      this.programId,
      mangoGroup,
      rootBank,
      nodeBanks,
    );

    const transaction = new Transaction();
    transaction.add(updateRootBanksInstruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async consumeEvents(
    mangoGroup: PublicKey,
    perpMarket: PublicKey,
    eventQueue: PublicKey,
    mangoAccounts: PublicKey[],
    payer: Account,
    limit: BN,
  ): Promise<TransactionSignature> {
    const updateRootBanksInstruction = makeConsumeEventsInstruction(
      this.programId,
      mangoGroup,
      perpMarket,
      eventQueue,
      mangoAccounts,
      limit,
    );

    const transaction = new Transaction();
    transaction.add(updateRootBanksInstruction);

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
    mangoCache: PublicKey,
    perpMarket: PerpMarket,
    owner: Account | WalletAdapter,

    side: 'buy' | 'sell',
    price: number,
    quantity: number,
    orderType?: 'limit' | 'ioc' | 'postOnly',
    clientOrderId = 0,
  ): Promise<TransactionSignature> {
    const marketIndex = mangoGroup.getPerpMarketIndex(perpMarket);

    // TODO: this will not work for perp markets without spot market
    const baseTokenInfo = mangoGroup.tokens[marketIndex];
    const quoteTokenInfo = mangoGroup.tokens[QUOTE_INDEX];
    const baseUnit = Math.pow(10, baseTokenInfo.decimals);
    const quoteUnit = Math.pow(10, quoteTokenInfo.decimals);

    const nativePrice = new BN(price * quoteUnit)
      .mul(perpMarket.contractSize)
      .div(perpMarket.quoteLotSize.mul(new BN(baseUnit)));
    const nativeQuantity = new BN(quantity * baseUnit).div(
      perpMarket.contractSize,
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
    );
    transaction.add(instruction);

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async cancelPerpOrder(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Account | WalletAdapter,
    perpMarket: PerpMarket,
    order: PerpOrder,
  ): Promise<TransactionSignature> {
    const instruction = makeCancelPerpOrderInstruction(
      this.programId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      owner.publicKey,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      perpMarket.eventQueue,
      order,
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
    spotMarket: PublicKey,
    mint: PublicKey,
    admin: Account,

    marketIndex: number,
    maintLeverage: number,
    initLeverage: number,
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
      spotMarket,
      mangoGroup.dexProgramId,
      mint,
      nodeBankAccountInstruction.account.publicKey,
      vaultAccount.publicKey,
      rootBankAccountInstruction.account.publicKey,
      admin.publicKey,
      new BN(marketIndex),
      I80F48.fromNumber(maintLeverage),
      I80F48.fromNumber(initLeverage),
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

    if (maxBaseQuantity.lte(new BN(0))) {
      throw new Error('size too small');
    }
    if (limitPrice.lte(new BN(0))) {
      throw new Error('invalid price');
    }
    const selfTradeBehavior = 'decrementTake';

    const spotMarketIndex = mangoGroup.getSpotMarketIndex(spotMarket.publicKey);

    const rootBanks = await mangoGroup.loadRootBanks(this.connection);
    const baseRootBank = rootBanks[0];
    const quoteRootBank = rootBanks[QUOTE_INDEX];
    const baseNodeBank = baseRootBank?.nodeBankAccounts[0];
    const quoteNodeBank = quoteRootBank?.nodeBankAccounts[0];

    if (!baseRootBank || !quoteRootBank || !baseNodeBank || !quoteNodeBank) {
      throw new Error('Invalid or missing banks');
    }

    const transaction = new Transaction();
    const additionalSigners: Account[] = [];
    const openOrdersKeys: PublicKey[] = [];
    for (let i = 0; i < mangoAccount.spotOpenOrders.length; i++) {
      if (
        i === spotMarketIndex &&
        mangoAccount.spotOpenOrders[spotMarketIndex].equals(zeroKey)
      ) {
        // open orders missing for this market; create a new one now
        const openOrdersSpace = OpenOrders.getLayout(
          mangoGroup.dexProgramId,
        ).span;
        const openOrdersLamports =
          await this.connection.getMinimumBalanceForRentExemption(
            openOrdersSpace,
            'singleGossip',
          );
        const accInstr = await createAccountInstruction(
          this.connection,
          owner.publicKey,
          openOrdersSpace,
          mangoGroup.dexProgramId,
          openOrdersLamports,
        );

        transaction.add(accInstr.instruction);
        additionalSigners.push(accInstr.account);
        openOrdersKeys.push(accInstr.account.publicKey);
      } else {
        openOrdersKeys.push(mangoAccount.spotOpenOrders[i]);
      }
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
      quoteRootBank.publicKey,
      quoteNodeBank.publicKey,
      quoteNodeBank.vault,
      baseNodeBank.vault,
      mangoGroup.signerKey,
      dexSigner,
      openOrdersKeys,

      side,
      limitPrice,
      maxBaseQuantity,
      maxQuoteQuantity,
      selfTradeBehavior,
      orderType,
    );
    transaction.add(placeOrderInstruction);

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async cancelSpotOrder(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Account | WalletAdapter,
    spotMarket: Market,
    order: Order,
  ): Promise<TransactionSignature> {
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

    const transaction = new Transaction();
    transaction.add(instruction);
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

    const rootBanks = await mangoGroup.loadRootBanks(this.connection);
    const baseRootBank = rootBanks[0];
    const quoteRootBank = rootBanks[QUOTE_INDEX];
    const baseNodeBank = baseRootBank?.nodeBankAccounts[0];
    const quoteNodeBank = quoteRootBank?.nodeBankAccounts[0];

    if (!baseNodeBank || !quoteNodeBank) {
      throw new Error('Invalid or missing node banks');
    }

    const instruction = makeSettleFundsInstruction(
      this.programId,
      mangoGroup.publicKey,
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
    owner: Account,
  ): Promise<TransactionSignature | null> {
    const transaction = new Transaction();

    const assetGains: number[] = new Array(MAX_TOKENS).fill(0);

    for (let i = 0; i < spotMarkets.length; i++) {
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

      assetGains[i] += openOrdersAccount.baseTokenFree.toNumber();
      assetGains[MAX_TOKENS - 1] +=
        openOrdersAccount.quoteTokenFree.toNumber() +
        openOrdersAccount['referrerRebatesAccrued'].toNumber();

      const spotMarket = spotMarkets[i];
      const dexSigner = await PublicKey.createProgramAddress(
        [
          spotMarket.publicKey.toBuffer(),
          spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
        ],
        spotMarket.programId,
      );

      const rootBanks = await mangoGroup.loadRootBanks(this.connection);
      const baseRootBank = rootBanks[0];
      const quoteRootBank = rootBanks[QUOTE_INDEX];
      const baseNodeBank = baseRootBank?.nodeBankAccounts[0];
      const quoteNodeBank = quoteRootBank?.nodeBankAccounts[0];

      if (!baseNodeBank || !quoteNodeBank) {
        throw new Error('Invalid or missing node banks');
      }

      const instruction = makeSettleFundsInstruction(
        this.programId,
        mangoGroup.publicKey,
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

      const transaction = new Transaction();
      transaction.add(instruction);
    }

    const additionalSigners = [];
    if (transaction.instructions.length == 0) {
      return null;
    } else {
      return await this.sendTransaction(transaction, owner, additionalSigners);
    }
  }

  /**
   * Automatically fetch MangoAccounts for this PerpMarket
   * Pick enough MangoAccounts that have opposite sign and send them in to get settled
   */
  async settlePnl(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    perpMarket: PerpMarket,
    quoteRootBank: RootBank,
    price: I80F48, // should be the MangoCache price
    owner: Account | WalletAdapter,
  ): Promise<TransactionSignature | null> {
    // fetch all MangoAccounts filtered for having this perp market in basket
    const marketIndex = mangoGroup.getPerpMarketIndex(perpMarket);
    const perpMarketInfo = mangoGroup.perpMarkets[marketIndex];
    const pnl = mangoAccount.perpAccounts[marketIndex].getPnl(
      perpMarketInfo,
      price,
    );

    // Can't settle pnl if there is no pnl
    if (pnl.eq(ZERO_I80F48)) {
      return null;
    }

    const mangoAccounts = await this.getAllMangoAccounts(mangoGroup, []);
    const sign = pnl.gt(ZERO_I80F48) ? 1 : -1;

    const accountsWithPnl = mangoAccounts
      .map((m) => ({
        account: m,
        pnl: m.perpAccounts[marketIndex].getPnl(perpMarketInfo, price),
      }))
      .sort((a, b) => sign * a.pnl.cmp(b.pnl));

    const transaction = new Transaction();
    const additionalSigners: Account[] = [];

    // TODO - make sure we limit number of instructions to not go over tx size limit
    for (const account of accountsWithPnl) {
      // if pnl has changed sign, then we're down
      const remSign = pnl.gt(ZERO_I80F48) ? 1 : -1;
      if (remSign !== sign) {
        break;
      }

      // Account pnl must have opposite signs
      if (pnl.mul(account.pnl).gte(ZERO_I80F48)) {
        break;
      }

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
    }

    return await this.sendTransaction(transaction, owner, additionalSigners);

    // Calculate the profit or loss per market
  }

  getMarginAccountsForOwner(
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
    includeOpenOrders = false,
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

    const mangoAccountProms = getFilteredProgramAccounts(
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

    if (!includeOpenOrders) {
      return await mangoAccountProms;
    }

    const ordersFilters = [
      {
        memcmp: {
          offset: OpenOrders.getLayout(mangoGroup.dexProgramId).offsetOf(
            'owner',
          ),
          bytes: mangoGroup.signerKey.toBase58(),
        },
      },
      {
        dataSize: OpenOrders.getLayout(mangoGroup.dexProgramId).span,
      },
    ];

    const openOrdersProms = getFilteredProgramAccounts(
      this.connection,
      mangoGroup.dexProgramId,
      ordersFilters,
    ).then((accounts) =>
      accounts.map(({ publicKey, accountInfo }) =>
        OpenOrders.fromAccountInfo(
          publicKey,
          accountInfo,
          mangoGroup.dexProgramId,
        ),
      ),
    );

    const mangoAccounts = await mangoAccountProms;
    const openOrders = await openOrdersProms;

    const pkToOpenOrdersAccount = {};
    openOrders.forEach(
      (openOrdersAccount) =>
        (pkToOpenOrdersAccount[openOrdersAccount.publicKey.toBase58()] =
          openOrdersAccount),
    );

    for (const ma of mangoAccounts) {
      for (let i = 0; i < ma.spotOpenOrders.length; i++) {
        if (ma.spotOpenOrders[i].toBase58() in pkToOpenOrdersAccount) {
          ma.spotOpenOrdersAccounts[i] =
            pkToOpenOrdersAccount[ma.spotOpenOrders[i].toBase58()];
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
    mangoGroupPk: PublicKey,
    admin: Account,
    marketIndex: number,
    maintLeverage: number,
    initLeverage: number,
    baseLotSize: number,
    quoteLotSize: number,
    maxNumEvents: number,
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
      PerpEventQueueLayout.span + maxNumEvents * PerpEventLayout.span,
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

    const instruction = await makeAddPerpMarketInstruction(
      this.programId,
      mangoGroupPk,
      makePerpMarketAccountInstruction.account.publicKey,
      makeEventQueueAccountInstruction.account.publicKey,
      makeBidAccountInstruction.account.publicKey,
      makeAskAccountInstruction.account.publicKey,
      admin.publicKey,
      new BN(marketIndex),
      I80F48.fromNumber(maintLeverage),
      I80F48.fromNumber(initLeverage),
      new BN(baseLotSize),
      new BN(quoteLotSize),
    );

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

  async getOrderBook() {}

  async getEventQueue(eventQueue: PublicKey): Promise<EventQueue> {
    const accountInfo = await this.connection.getAccountInfo(eventQueue);
    EventQueueLayout;
    const decoded = PerpEventQueueLayout.decode(
      accountInfo == null ? undefined : accountInfo.data,
      0,
    );

    return new EventQueue(decoded);
  }
}
