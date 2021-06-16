import {
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from '@solana/web3.js';
import { encodeMerpsInstruction } from './layout';
import BN from 'bn.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Order } from '@project-serum/serum/lib/market';
import { I80F48 } from './fixednum';

export function makeInitMerpsGroupInstruction(
  programId: PublicKey,
  merpsGroupPk: PublicKey,
  signerKey: PublicKey,
  payerPk: PublicKey,
  quoteMintPk: PublicKey,
  quoteVaultPk: PublicKey,
  quoteNodeBankPk: PublicKey,
  quoteRootBankPk: PublicKey,
  merpsCachePk: PublicKey,
  dexProgramPk: PublicKey,

  signerNonce: number,
  validInterval: number,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: merpsGroupPk },
    { isSigner: false, isWritable: false, pubkey: signerKey },
    { isSigner: true, isWritable: false, pubkey: payerPk },
    { isSigner: false, isWritable: false, pubkey: quoteMintPk },
    { isSigner: false, isWritable: true, pubkey: quoteVaultPk },
    { isSigner: false, isWritable: true, pubkey: quoteNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteRootBankPk },
    { isSigner: false, isWritable: true, pubkey: merpsCachePk },
    { isSigner: false, isWritable: false, pubkey: dexProgramPk },
  ];

  const data = encodeMerpsInstruction({
    InitMerpsGroup: {
      signerNonce: new BN(signerNonce),
      validInterval: new BN(validInterval),
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId: programId,
  });
}

export function makeInitMerpsAccountInstruction(
  programId: PublicKey,
  merpsGroupPk: PublicKey,
  merpsAccountPk: PublicKey,
  ownerPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: merpsGroupPk },
    { isSigner: false, isWritable: true, pubkey: merpsAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
  ];

  const data = encodeMerpsInstruction({ InitMerpsAccount: {} });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeTestMultiTxInstruction(
  programId: PublicKey,
  merpsGroup: PublicKey,
  index: number,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: merpsGroup },
    { isSigner: false, isWritable: false, pubkey: SYSVAR_CLOCK_PUBKEY },
  ];

  const data = encodeMerpsInstruction({
    TestMultiTx: { index: new BN(index) },
  });

  return new TransactionInstruction({ keys, data, programId });
}

export function makePlacePerpOrderInstruction(): TransactionInstruction {
  throw new Error('Not Implemented');
}

export function makeWithdrawInstruction(
  programId: PublicKey,
  merpsGroupPk: PublicKey,
  merpsAccountPk: PublicKey,
  walletPk: PublicKey,
  merpsCachePk: PublicKey,
  rootBankPk: PublicKey,
  nodeBankPk: PublicKey,
  vaultPk: PublicKey,
  tokenAccPk: PublicKey,
  signerKey: PublicKey,
  openOrders: PublicKey[],

  nativeQuantity: BN,
  allowBorrow: boolean,
): TransactionInstruction {
  const withdrawKeys = [
    { isSigner: false, isWritable: false, pubkey: merpsGroupPk },
    { isSigner: false, isWritable: true, pubkey: merpsAccountPk },
    { isSigner: true, isWritable: false, pubkey: walletPk },
    { isSigner: false, isWritable: false, pubkey: merpsCachePk },
    { isSigner: false, isWritable: false, pubkey: rootBankPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    { isSigner: false, isWritable: true, pubkey: vaultPk },
    { isSigner: false, isWritable: true, pubkey: tokenAccPk },
    { isSigner: false, isWritable: false, pubkey: signerKey },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    ...openOrders.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];
  const withdrawData = encodeMerpsInstruction({
    Withdraw: { quantity: nativeQuantity, allowBorrow: allowBorrow },
  });
  return new TransactionInstruction({
    keys: withdrawKeys,
    data: withdrawData,
    programId,
  });
}

export function makeSettleFundsInstruction(
  programId: PublicKey,
  merpsGroupPk: PublicKey,
  ownerPk: PublicKey,
  merpsAccountPk: PublicKey,
  dexProgramId: PublicKey,
  spotMarketPk: PublicKey,
  openOrdersPk: PublicKey,
  signerKey: PublicKey,
  spotMarketBaseVaultPk: PublicKey,
  spotMarketQuoteVaultPk: PublicKey,
  baseRootBankPk: PublicKey,
  baseNodeBankPk: PublicKey,
  quoteRootBankPk: PublicKey,
  quoteNodeBankPk: PublicKey,
  baseVaultPk: PublicKey,
  quoteVaultPk: PublicKey,
  dexSignerKey: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: merpsGroupPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: merpsAccountPk },
    { isSigner: false, isWritable: false, pubkey: dexProgramId },
    { isSigner: false, isWritable: true, pubkey: spotMarketPk },
    { isSigner: false, isWritable: true, pubkey: openOrdersPk },
    { isSigner: false, isWritable: false, pubkey: signerKey },
    { isSigner: false, isWritable: true, pubkey: spotMarketBaseVaultPk },
    { isSigner: false, isWritable: true, pubkey: spotMarketQuoteVaultPk },
    { isSigner: false, isWritable: false, pubkey: baseRootBankPk },
    { isSigner: false, isWritable: true, pubkey: baseNodeBankPk },
    { isSigner: false, isWritable: false, pubkey: quoteRootBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: baseVaultPk },
    { isSigner: false, isWritable: true, pubkey: quoteVaultPk },
    { isSigner: false, isWritable: false, pubkey: dexSignerKey },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
  ];
  const data = encodeMerpsInstruction({ SettleFunds: {} });

  return new TransactionInstruction({ keys, data, programId });
}

export function makeCancelOrderInstruction(
  programId: PublicKey,
  merpsGroupPk: PublicKey,
  ownerPk: PublicKey,
  merpsAccountPk: PublicKey,
  dexProgramId: PublicKey,
  spotMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  openOrdersPk: PublicKey,
  signerKey: PublicKey,
  eventQueuePk: PublicKey,
  order: Order,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: merpsGroupPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: merpsAccountPk },
    { isSigner: false, isWritable: false, pubkey: dexProgramId },
    { isSigner: false, isWritable: false, pubkey: spotMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: true, pubkey: openOrdersPk },
    { isSigner: false, isWritable: false, pubkey: signerKey },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
  ];

  const data = encodeMerpsInstruction({
    CancelOrder: {
      side: order.side,
      orderId: order.orderId,
    },
  });
  return new TransactionInstruction({ keys, data, programId });
}

export function makeDepositInstruction(
  programId: PublicKey,
  merpsGroupPk: PublicKey,
  ownerPk: PublicKey,
  merpsAccountPk: PublicKey,
  rootBankPk: PublicKey,
  nodeBankPk: PublicKey,
  vaultPk: PublicKey,
  tokenAccPk: PublicKey,

  nativeQuantity: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: merpsGroupPk },
    { isSigner: false, isWritable: true, pubkey: merpsAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: rootBankPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    { isSigner: false, isWritable: true, pubkey: vaultPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    { isSigner: false, isWritable: true, pubkey: tokenAccPk },
  ];
  const data = encodeMerpsInstruction({
    Deposit: { quantity: nativeQuantity },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCacheRootBankInstruction(
  programId: PublicKey,
  merpsGroupPk: PublicKey,
  merpsCachePk: PublicKey,
  rootBanks: PublicKey[],
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: merpsGroupPk },
    { isSigner: false, isWritable: true, pubkey: merpsCachePk },
    ...rootBanks.map((pubkey) => ({
      isSigner: false,
      isWritable: true,
      pubkey,
    })),
  ];

  const data = encodeMerpsInstruction({
    CacheRootBanks: {},
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCachePricesInstruction(
  programId: PublicKey,
  merpsGroupPk: PublicKey,
  merpsCachePk: PublicKey,
  oracles: PublicKey[],
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: merpsGroupPk },
    { isSigner: false, isWritable: true, pubkey: merpsCachePk },
    ...oracles.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];

  const data = encodeMerpsInstruction({
    CachePrices: {},
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeAddSpotMarketInstruction(
  programId: PublicKey,
  merpsGroupPk: PublicKey,
  spotMarketPk: PublicKey,
  serumDexPk: PublicKey,
  mintPk: PublicKey,
  nodeBankPk: PublicKey,
  vaultPk: PublicKey,
  rootBankPk: PublicKey,
  adminPk: PublicKey,

  marketIndex: number,
  maintLeverage: I80F48,
  initLeverage: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: merpsGroupPk },
    { isSigner: false, isWritable: false, pubkey: spotMarketPk },
    { isSigner: false, isWritable: false, pubkey: serumDexPk },
    { isSigner: false, isWritable: false, pubkey: mintPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    { isSigner: false, isWritable: false, pubkey: vaultPk },
    { isSigner: false, isWritable: true, pubkey: rootBankPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];

  const data = encodeMerpsInstruction({
    AddSpotMarket: {
      marketIndex: new BN(marketIndex),
      maintLeverage,
      initLeverage,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeAddToBasketInstruction(
  programId: PublicKey,
  merpsGroupPk: PublicKey,
  merpsAccountPk: PublicKey,
  ownerPk: PublicKey,
  marketIndex: number,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: merpsGroupPk },
    { isSigner: false, isWritable: true, pubkey: merpsAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
  ];

  const data = encodeMerpsInstruction({
    AddToBasket: {
      marketIndex: new BN(marketIndex),
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makePlaceSpotOrderInstruction(
  programId: PublicKey,
  merpsGroupPk: PublicKey,
  merpsAccountPk: PublicKey,
  ownerPk: PublicKey,
  merpsCachePk: PublicKey,
  serumDexPk: PublicKey,
  spotMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  requestQueuePk: PublicKey,
  eventQueuePk: PublicKey,
  spotMktBaseVaultPk: PublicKey,
  spotMktQuoteVaultPk: PublicKey,
  baseRootBankPk: PublicKey,
  baseNodeBankPk: PublicKey,
  quoteRootBankPk: PublicKey,
  quoteNodeBankPk: PublicKey,
  quoteVaultPk: PublicKey,
  baseVaultPk: PublicKey,
  signerPk: PublicKey,
  dexSignerPk: PublicKey,
  openOrders: PublicKey[],

  side: 'buy' | 'sell',
  limitPrice: BN,
  maxBaseQuantity: BN,
  maxQuoteQuantity: BN,
  selfTradeBehavior: string,
  orderType?: 'limit' | 'ioc' | 'postOnly',
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: merpsGroupPk },
    { isSigner: false, isWritable: true, pubkey: merpsAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: merpsCachePk },
    { isSigner: false, isWritable: false, pubkey: serumDexPk },
    { isSigner: false, isWritable: true, pubkey: spotMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: true, pubkey: requestQueuePk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    { isSigner: false, isWritable: true, pubkey: spotMktBaseVaultPk },
    { isSigner: false, isWritable: true, pubkey: spotMktQuoteVaultPk },
    { isSigner: false, isWritable: false, pubkey: baseRootBankPk },
    { isSigner: false, isWritable: true, pubkey: baseNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteRootBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteVaultPk },
    { isSigner: false, isWritable: true, pubkey: baseVaultPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: false, pubkey: SYSVAR_RENT_PUBKEY },
    { isSigner: false, isWritable: false, pubkey: dexSignerPk },
    ...openOrders.map((pubkey) => ({
      isSigner: false,
      isWritable: true,
      pubkey,
    })),
  ];

  const data = encodeMerpsInstruction({
    PlaceSpotOrder: {
      side,
      limitPrice,
      maxBaseQuantity,
      maxQuoteQuantity,
      selfTradeBehavior,
      orderType,
      limit: 65535,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeUpdateRootBankInstruction(
  programId: PublicKey,
  merpsGroupPk: PublicKey,
  rootBankPk: PublicKey,
  nodeBanks: PublicKey[],
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: merpsGroupPk },
    { isSigner: false, isWritable: true, pubkey: rootBankPk },
    ...nodeBanks.map((pubkey) => ({
      isSigner: false,
      isWritable: true,
      pubkey,
    })),
  ];

  const data = encodeMerpsInstruction({
    UpdateRootBank: {},
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeAddOracleInstruction(
  programId: PublicKey,
  merpsGroupPk: PublicKey,
  oraclePk: PublicKey,
  adminPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: merpsGroupPk },
    { isSigner: false, isWritable: false, pubkey: oraclePk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];
  const data = encodeMerpsInstruction({ AddOracle: {} });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeSetOracleInstruction(
  programId: PublicKey,
  merpsGroupPk: PublicKey,
  oraclePk: PublicKey,
  adminPk: PublicKey,
  price: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: merpsGroupPk },
    { isSigner: false, isWritable: true, pubkey: oraclePk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];
  const data = encodeMerpsInstruction({
    SetOracle: { price },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeAddPerpMarketInstruction(
  programId: PublicKey,
  merpsGroupPk: PublicKey,
  perpMarketPk: PublicKey,
  eventQueuePk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  adminPk: PublicKey,
  marketIndex: BN,
  maintLeverage: I80F48,
  initLeverage: I80F48,
  baseLotSize: BN,
  quoteLotSize: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: merpsGroupPk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];
  const data = encodeMerpsInstruction({
    AddPerpMarket: {
      marketIndex,
      maintLeverage,
      initLeverage,
      baseLotSize,
      quoteLotSize,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}
