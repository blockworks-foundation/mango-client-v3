import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from '@solana/web3.js';
import { AssetType, encodeMangoInstruction, INFO_LEN } from './layout';
import BN from 'bn.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Order } from '@project-serum/serum/lib/market';
import { I80F48, ZERO_I80F48 } from './utils/fixednum';
import { PerpOrder } from './book';
import { PerpOrderType } from './utils/types';
import { ZERO_BN } from './utils/utils';

export function makeInitMangoGroupInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  signerKey: PublicKey,
  payerPk: PublicKey,
  quoteMintPk: PublicKey,
  quoteVaultPk: PublicKey,
  quoteNodeBankPk: PublicKey,
  quoteRootBankPk: PublicKey,
  insuranceVaultPk: PublicKey,
  msrmVaultPk: PublicKey,
  feesVaultPk: PublicKey,
  mangoCachePk: PublicKey,
  dexProgramPk: PublicKey,

  signerNonce: BN,
  validInterval: BN,
  quoteOptimalUtil: I80F48,
  quoteOptimalRate: I80F48,
  quoteMaxRate: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: signerKey },
    { isSigner: true, isWritable: false, pubkey: payerPk },
    { isSigner: false, isWritable: false, pubkey: quoteMintPk },
    { isSigner: false, isWritable: true, pubkey: quoteVaultPk },
    { isSigner: false, isWritable: true, pubkey: quoteNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteRootBankPk },
    { isSigner: false, isWritable: false, pubkey: insuranceVaultPk },
    { isSigner: false, isWritable: false, pubkey: msrmVaultPk },
    { isSigner: false, isWritable: false, pubkey: feesVaultPk },
    { isSigner: false, isWritable: true, pubkey: mangoCachePk },
    { isSigner: false, isWritable: false, pubkey: dexProgramPk },
  ];

  const data = encodeMangoInstruction({
    InitMangoGroup: {
      signerNonce,
      validInterval,
      quoteOptimalUtil,
      quoteOptimalRate,
      quoteMaxRate,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId: programId,
  });
}

export function makeInitMangoAccountInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
  ];

  const data = encodeMangoInstruction({ InitMangoAccount: {} });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeWithdrawInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  walletPk: PublicKey,
  mangoCachePk: PublicKey,
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
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: walletPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
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
  const withdrawData = encodeMangoInstruction({
    Withdraw: { quantity: nativeQuantity, allowBorrow },
  });
  return new TransactionInstruction({
    keys: withdrawKeys,
    data: withdrawData,
    programId,
  });
}

export function makeSettleFundsInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoCachePk: PublicKey,
  ownerPk: PublicKey,
  mangoAccountPk: PublicKey,
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
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
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
  const data = encodeMangoInstruction({ SettleFunds: {} });

  return new TransactionInstruction({ keys, data, programId });
}

export function makeCancelSpotOrderInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  ownerPk: PublicKey,
  mangoAccountPk: PublicKey,
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
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: mangoAccountPk },
    { isSigner: false, isWritable: false, pubkey: dexProgramId },
    { isSigner: false, isWritable: true, pubkey: spotMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: true, pubkey: openOrdersPk },
    { isSigner: false, isWritable: false, pubkey: signerKey },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
  ];

  const data = encodeMangoInstruction({
    CancelSpotOrder: {
      side: order.side,
      orderId: order.orderId,
    },
  });
  return new TransactionInstruction({ keys, data, programId });
}

export function makeCancelPerpOrderInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  perpMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  order: PerpOrder,
  invalidIdOk: boolean,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
  ];

  const data = encodeMangoInstruction({
    CancelPerpOrder: {
      orderId: order.orderId,
      invalidIdOk,
    },
  });

  return new TransactionInstruction({ keys, data, programId });
}

export function makeCancelPerpOrderByClientIdInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  perpMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  clientOrderId: BN,
  invalidIdOk: boolean,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
  ];

  const data = encodeMangoInstruction({
    CancelPerpOrderByClientId: {
      clientOrderId,
      invalidIdOk,
    },
  });
  return new TransactionInstruction({ keys, data, programId });
}

export function makeCancelAllPerpOrdersInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  perpMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  limit: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
  ];

  const data = encodeMangoInstruction({
    CancelAllPerpOrders: {
      limit,
    },
  });
  return new TransactionInstruction({ keys, data, programId });
}

export function makeDepositInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  ownerPk: PublicKey,
  merpsCachePk: PublicKey,
  mangoAccountPk: PublicKey,
  rootBankPk: PublicKey,
  nodeBankPk: PublicKey,
  vaultPk: PublicKey,
  tokenAccPk: PublicKey,

  nativeQuantity: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: merpsCachePk },
    { isSigner: false, isWritable: true, pubkey: rootBankPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    { isSigner: false, isWritable: true, pubkey: vaultPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    { isSigner: false, isWritable: true, pubkey: tokenAccPk },
  ];
  const data = encodeMangoInstruction({
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
  mangoGroupPk: PublicKey,
  mangoCachePk: PublicKey,
  rootBanks: PublicKey[],
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoCachePk },
    ...rootBanks.map((pubkey) => ({
      isSigner: false,
      isWritable: true,
      pubkey,
    })),
  ];

  const data = encodeMangoInstruction({
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
  mangoGroupPk: PublicKey,
  mangoCachePk: PublicKey,
  oracles: PublicKey[],
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoCachePk },
    ...oracles.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];

  const data = encodeMangoInstruction({
    CachePrices: {},
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCachePerpMarketInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoCachePk: PublicKey,
  perpMarketPks: PublicKey[],
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoCachePk },
    ...perpMarketPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];

  const data = encodeMangoInstruction({
    CachePerpMarkets: {},
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeAddSpotMarketInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  oraclePk: PublicKey,
  spotMarketPk: PublicKey,
  serumDexPk: PublicKey,
  mintPk: PublicKey,
  nodeBankPk: PublicKey,
  vaultPk: PublicKey,
  rootBankPk: PublicKey,
  adminPk: PublicKey,

  maintLeverage: I80F48,
  initLeverage: I80F48,
  liquidationFee: I80F48,
  optimalUtil: I80F48,
  optimalRate: I80F48,
  maxRate: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: oraclePk },
    { isSigner: false, isWritable: false, pubkey: spotMarketPk },
    { isSigner: false, isWritable: false, pubkey: serumDexPk },
    { isSigner: false, isWritable: false, pubkey: mintPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    { isSigner: false, isWritable: false, pubkey: vaultPk },
    { isSigner: false, isWritable: true, pubkey: rootBankPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];

  const data = encodeMangoInstruction({
    AddSpotMarket: {
      maintLeverage,
      initLeverage,
      liquidationFee,
      optimalUtil,
      optimalRate,
      maxRate,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeInitSpotOpenOrdersInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  serumDexPk: PublicKey,
  openOrdersPk: PublicKey,
  spotMarketPk: PublicKey,
  signerPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: serumDexPk },
    { isSigner: false, isWritable: true, pubkey: openOrdersPk },
    { isSigner: false, isWritable: false, pubkey: spotMarketPk },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: false, pubkey: SYSVAR_RENT_PUBKEY },
  ];

  const data = encodeMangoInstruction({
    InitSpotOpenOrders: {},
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCreateSpotOpenOrdersInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  serumDexPk: PublicKey,
  openOrdersPk: PublicKey,
  spotMarketPk: PublicKey,
  signerPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: true, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: serumDexPk },
    { isSigner: false, isWritable: true, pubkey: openOrdersPk },
    { isSigner: false, isWritable: false, pubkey: spotMarketPk },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
  ];

  const data = encodeMangoInstruction({
    CreateSpotOpenOrders: {},
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makePlaceSpotOrderInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  mangoCachePk: PublicKey,
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
  baseVaultPk: PublicKey,
  quoteRootBankPk: PublicKey,
  quoteNodeBankPk: PublicKey,
  quoteVaultPk: PublicKey,
  signerPk: PublicKey,
  dexSignerPk: PublicKey,
  msrmOrSrmVaultPk: PublicKey,
  // pass in only openOrders in margin basket, and only the market index one should be writable
  openOrders: { pubkey: PublicKey; isWritable: boolean }[],

  side: 'buy' | 'sell',
  limitPrice: BN,
  maxBaseQuantity: BN,
  maxQuoteQuantity: BN,
  selfTradeBehavior: string,
  orderType?: 'limit' | 'ioc' | 'postOnly',
  clientId?: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
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
    { isSigner: false, isWritable: true, pubkey: baseVaultPk },
    { isSigner: false, isWritable: false, pubkey: quoteRootBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteVaultPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: false, pubkey: SYSVAR_RENT_PUBKEY },
    { isSigner: false, isWritable: false, pubkey: dexSignerPk },
    { isSigner: false, isWritable: false, pubkey: msrmOrSrmVaultPk },
    ...openOrders.map(({ pubkey, isWritable }) => ({
      isSigner: false,
      isWritable,
      pubkey,
    })),
  ];

  const data = encodeMangoInstruction({
    PlaceSpotOrder: {
      side,
      limitPrice,
      maxBaseQuantity,
      maxQuoteQuantity,
      selfTradeBehavior,
      orderType,
      clientId,
      limit: 65535,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makePlaceSpotOrder2Instruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  mangoCachePk: PublicKey,
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
  baseVaultPk: PublicKey,
  quoteRootBankPk: PublicKey,
  quoteNodeBankPk: PublicKey,
  quoteVaultPk: PublicKey,
  signerPk: PublicKey,
  dexSignerPk: PublicKey,
  msrmOrSrmVaultPk: PublicKey,
  // pass in only openOrders in margin basket, and only the market index one should be writable
  openOrders: { pubkey: PublicKey; isWritable: boolean }[],

  side: 'buy' | 'sell',
  limitPrice: BN,
  maxBaseQuantity: BN,
  maxQuoteQuantity: BN,
  selfTradeBehavior: string,
  orderType?: 'limit' | 'ioc' | 'postOnly',
  clientOrderId?: BN,
): TransactionInstruction {
  // TODO - this is wrong, accounts have changed in place spot 2
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
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
    { isSigner: false, isWritable: true, pubkey: baseVaultPk },
    { isSigner: false, isWritable: false, pubkey: quoteRootBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteVaultPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: false, pubkey: dexSignerPk },
    { isSigner: false, isWritable: false, pubkey: msrmOrSrmVaultPk },
    ...openOrders.map(({ pubkey, isWritable }) => ({
      isSigner: false,
      isWritable,
      pubkey,
    })),
  ];

  const data = encodeMangoInstruction({
    PlaceSpotOrder2: {
      side,
      limitPrice,
      maxBaseQuantity,
      maxQuoteQuantity,
      selfTradeBehavior,
      orderType,
      clientOrderId,
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
  mangoGroupPk: PublicKey,
  mangoCachePk: PublicKey,
  rootBankPk: PublicKey,
  nodeBanks: PublicKey[],
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoCachePk },
    { isSigner: false, isWritable: true, pubkey: rootBankPk },
    ...nodeBanks.map((pubkey) => ({
      isSigner: false,
      isWritable: true,
      pubkey,
    })),
  ];

  const data = encodeMangoInstruction({
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
  mangoGroupPk: PublicKey,
  oraclePk: PublicKey,
  adminPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: oraclePk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];
  const data = encodeMangoInstruction({ AddOracle: {} });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeSetOracleInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  oraclePk: PublicKey,
  adminPk: PublicKey,
  price: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: oraclePk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];
  const data = encodeMangoInstruction({
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
  mangoGroupPk: PublicKey,
  oraclePk: PublicKey,
  perpMarketPk: PublicKey,
  eventQueuePk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  mngoVaultPk: PublicKey,
  adminPk: PublicKey,
  maintLeverage: I80F48,
  initLeverage: I80F48,
  liquidationFee: I80F48,
  makerFee: I80F48,
  takerFee: I80F48,
  baseLotSize: BN,
  quoteLotSize: BN,
  rate: I80F48,
  maxDepthBps: I80F48,
  targetPeriodLength: BN,
  mngoPerPeriod: BN,
  exp: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: oraclePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: false, pubkey: mngoVaultPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];
  const data = encodeMangoInstruction({
    AddPerpMarket: {
      maintLeverage,
      initLeverage,
      liquidationFee,
      makerFee,
      takerFee,
      baseLotSize,
      quoteLotSize,
      rate,
      maxDepthBps,
      targetPeriodLength,
      mngoPerPeriod,
      exp,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCreatePerpMarketInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  oraclePk: PublicKey,
  perpMarketPk: PublicKey,
  eventQueuePk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  mngoMintPk: PublicKey,
  mngoVaultPk: PublicKey,
  adminPk: PublicKey,
  signerPk: PublicKey,
  maintLeverage: I80F48,
  initLeverage: I80F48,
  liquidationFee: I80F48,
  makerFee: I80F48,
  takerFee: I80F48,
  baseLotSize: BN,
  quoteLotSize: BN,
  rate: I80F48,
  maxDepthBps: I80F48,
  targetPeriodLength: BN,
  mngoPerPeriod: BN,
  exp: BN,
  version: BN,
  lmSizeShift: BN,
  baseDecimals: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: oraclePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: false, pubkey: mngoMintPk },
    { isSigner: false, isWritable: true, pubkey: mngoVaultPk },
    { isSigner: true, isWritable: true, pubkey: adminPk },
    { isSigner: false, isWritable: true, pubkey: signerPk }, // TODO: does this need to be signer?
    { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    { isSigner: false, isWritable: false, pubkey: SYSVAR_RENT_PUBKEY },
  ];

  const data = encodeMangoInstruction({
    CreatePerpMarket: {
      maintLeverage,
      initLeverage,
      liquidationFee,
      makerFee,
      takerFee,
      baseLotSize,
      quoteLotSize,
      rate,
      maxDepthBps,
      targetPeriodLength,
      mngoPerPeriod,
      exp,
      version,
      lmSizeShift,
      baseDecimals,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCachePerpMarketsInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoCachePk: PublicKey,
  perpMarkets: PublicKey[],
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoCachePk },
    ...perpMarkets.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];

  const data = encodeMangoInstruction({
    CachePerpMarkets: {},
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeSettlePnlInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountAPk: PublicKey,
  mangoAccountBPk: PublicKey,
  mangoCachePk: PublicKey,
  rootBankPk: PublicKey,
  nodeBankPk: PublicKey,
  marketIndex: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountAPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountBPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
    { isSigner: false, isWritable: false, pubkey: rootBankPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
  ];
  const data = encodeMangoInstruction({
    SettlePnl: {
      marketIndex,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeConsumeEventsInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoCachePk: PublicKey,
  perpMarketPk: PublicKey,
  eventQueuePk: PublicKey,
  mangoAccountPks: PublicKey[],
  limit: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    ...mangoAccountPks.sort().map((pubkey) => ({
      isSigner: false,
      isWritable: true,
      pubkey,
    })),
  ];

  const data = encodeMangoInstruction({
    ConsumeEvents: { limit },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makePlacePerpOrderInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  mangoCachePk: PublicKey,
  perpMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  eventQueuePk: PublicKey,
  openOrders: PublicKey[],
  price: BN,
  quantity: BN,
  clientOrderId: BN,
  side: 'buy' | 'sell',
  orderType?: PerpOrderType,
  reduceOnly?: boolean,
  referrerMangoAccountPk?: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    ...openOrders.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];
  if (referrerMangoAccountPk !== undefined) {
    keys.push({
      isSigner: false,
      isWritable: true,
      pubkey: referrerMangoAccountPk,
    });
  }

  const data = encodeMangoInstruction({
    PlacePerpOrder: {
      price,
      quantity,
      clientOrderId,
      side,
      orderType,
      reduceOnly: reduceOnly ? reduceOnly : false,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makePlacePerpOrder2Instruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  mangoCachePk: PublicKey,
  perpMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  eventQueuePk: PublicKey,
  openOrders: PublicKey[], // pass in only open orders in margin basket
  price: BN,
  maxBaseQuantity: BN,
  maxQuoteQuantity: BN,
  clientOrderId: BN,
  side: 'buy' | 'sell',
  limit: BN, // one byte; max 255

  orderType?: PerpOrderType,
  reduceOnly?: boolean,
  referrerMangoAccountPk?: PublicKey,
  expiryTimestamp?: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    {
      isSigner: false,
      isWritable: true,
      pubkey: referrerMangoAccountPk ? referrerMangoAccountPk : mangoAccountPk,
    },
    ...openOrders.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];
  if (referrerMangoAccountPk !== undefined) {
    keys.push({
      isSigner: false,
      isWritable: true,
      pubkey: referrerMangoAccountPk,
    });
  }

  const data = encodeMangoInstruction({
    PlacePerpOrder2: {
      price,
      maxBaseQuantity,
      maxQuoteQuantity,
      clientOrderId,
      expiryTimestamp: expiryTimestamp ? expiryTimestamp : ZERO_BN,
      side,
      orderType,
      reduceOnly: reduceOnly ? reduceOnly : false,
      limit,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeUpdateFundingInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoCachePk: PublicKey,
  perpMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoCachePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: false, pubkey: bidsPk },
    { isSigner: false, isWritable: false, pubkey: asksPk },
  ];

  const data = encodeMangoInstruction({
    UpdateFunding: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeForceCancelSpotOrdersInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoCachePk: PublicKey,
  liqeeMangoAccountPk: PublicKey,
  baseRootBankPk: PublicKey,
  baseNodeBankPk: PublicKey,
  baseVaultPk: PublicKey,
  quoteRootBankPk: PublicKey,
  quoteNodeBankPk: PublicKey,
  quoteVaultPk: PublicKey,
  spotMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  signerPk: PublicKey,
  dexEventQueuePk: PublicKey,
  dexBasePk: PublicKey,
  dexQuotePk: PublicKey,
  dexSignerPk: PublicKey,
  dexProgramPk: PublicKey,
  liqeeOpenOrdersKeys: { pubkey: PublicKey; isWritable: boolean }[],
  limit: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
    { isSigner: false, isWritable: true, pubkey: liqeeMangoAccountPk },
    { isSigner: false, isWritable: false, pubkey: baseRootBankPk },
    { isSigner: false, isWritable: true, pubkey: baseNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: baseVaultPk },
    { isSigner: false, isWritable: false, pubkey: quoteRootBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteVaultPk },
    { isSigner: false, isWritable: true, pubkey: spotMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: true, pubkey: dexEventQueuePk },
    { isSigner: false, isWritable: true, pubkey: dexBasePk },
    { isSigner: false, isWritable: true, pubkey: dexQuotePk },
    { isSigner: false, isWritable: false, pubkey: dexSignerPk },
    { isSigner: false, isWritable: false, pubkey: dexProgramPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    ...liqeeOpenOrdersKeys.map(({ pubkey, isWritable }) => ({
      isSigner: false,
      isWritable,
      pubkey,
    })),
  ];

  const data = encodeMangoInstruction({
    ForceCancelSpotOrders: {
      limit,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeForceCancelPerpOrdersInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoCachePk: PublicKey,
  perpMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  liqeeMangoAccountPk: PublicKey,
  liqorOpenOrdersPks: PublicKey[],
  limit: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
    { isSigner: false, isWritable: false, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: true, pubkey: liqeeMangoAccountPk },
    ...liqorOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];

  const data = encodeMangoInstruction({
    ForceCancelPerpOrders: {
      limit,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeLiquidateTokenAndTokenInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoCachePk: PublicKey,
  liqeeMangoAccountPk: PublicKey,
  liqorMangoAccountPk: PublicKey,
  liqorAccountPk: PublicKey,
  assetRootBankPk: PublicKey,
  assetNodeBankPk: PublicKey,
  liabRootBankPk: PublicKey,
  liabNodeBankPk: PublicKey,
  liqeeOpenOrdersPks: PublicKey[],
  liqorOpenOrdersPks: PublicKey[],
  maxLiabTransfer: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
    { isSigner: false, isWritable: true, pubkey: liqeeMangoAccountPk },
    { isSigner: false, isWritable: true, pubkey: liqorMangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: liqorAccountPk },
    { isSigner: false, isWritable: false, pubkey: assetRootBankPk },
    { isSigner: false, isWritable: true, pubkey: assetNodeBankPk },
    { isSigner: false, isWritable: false, pubkey: liabRootBankPk },
    { isSigner: false, isWritable: true, pubkey: liabNodeBankPk },
    ...liqeeOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
    ...liqorOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];

  const data = encodeMangoInstruction({
    LiquidateTokenAndToken: {
      maxLiabTransfer,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeLiquidateTokenAndPerpInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoCachePk: PublicKey,
  liqeeMangoAccountPk: PublicKey,
  liqorMangoAccountPk: PublicKey,
  liqorAccountPk: PublicKey,
  rootBankPk: PublicKey,
  nodeBankPk: PublicKey,
  liqeeOpenOrdersPks: PublicKey[],
  liqorOpenOrdersPks: PublicKey[],
  assetType: AssetType,
  assetIndex: BN,
  liabType: AssetType,
  liabIndex: BN,
  maxLiabTransfer: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
    { isSigner: false, isWritable: true, pubkey: liqeeMangoAccountPk },
    { isSigner: false, isWritable: true, pubkey: liqorMangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: liqorAccountPk },
    { isSigner: false, isWritable: false, pubkey: rootBankPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    ...liqeeOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
    ...liqorOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];

  const data = encodeMangoInstruction({
    LiquidateTokenAndPerp: {
      assetType,
      assetIndex,
      liabType,
      liabIndex,
      maxLiabTransfer,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeLiquidatePerpMarketInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoCachePk: PublicKey,
  perpMarketPk: PublicKey,
  eventQueuePk: PublicKey,
  liqeeMangoAccountPk: PublicKey,
  liqorMangoAccountPk: PublicKey,
  liqorAccountPk: PublicKey,
  liqeeOpenOrdersPks: PublicKey[],
  liqorOpenOrdersPks: PublicKey[],
  baseTransferRequest: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    { isSigner: false, isWritable: true, pubkey: liqeeMangoAccountPk },
    { isSigner: false, isWritable: true, pubkey: liqorMangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: liqorAccountPk },
    ...liqeeOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
    ...liqorOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];

  const data = encodeMangoInstruction({
    LiquidatePerpMarket: {
      baseTransferRequest,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeSettleFeesInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoCachePk: PublicKey,
  perpMarketPk: PublicKey,
  mangoAccountPk: PublicKey,
  rootBankPk: PublicKey,
  nodeBankPk: PublicKey,
  bankVaultPk: PublicKey,
  feesVaultPk: PublicKey,
  signerPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: false, isWritable: false, pubkey: rootBankPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    { isSigner: false, isWritable: true, pubkey: bankVaultPk },
    { isSigner: false, isWritable: true, pubkey: feesVaultPk },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
  ];

  const data = encodeMangoInstruction({
    SettleFees: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeResolvePerpBankruptcyInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoCachePk: PublicKey,
  liqeeMangoAccountPk: PublicKey,
  liqorMangoAccountPk: PublicKey,
  liqorPk: PublicKey,
  rootBankPk: PublicKey,
  nodeBankPk: PublicKey,
  vaultPk: PublicKey,
  insuranceVaultPk: PublicKey,
  signerPk: PublicKey,
  perpMarketPk: PublicKey,
  liqorOpenOrdersPks: PublicKey[],
  liabIndex: BN,
  maxLiabTransfer: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoCachePk },
    { isSigner: false, isWritable: true, pubkey: liqeeMangoAccountPk },
    { isSigner: false, isWritable: true, pubkey: liqorMangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: liqorPk },
    { isSigner: false, isWritable: false, pubkey: rootBankPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    { isSigner: false, isWritable: true, pubkey: vaultPk },
    { isSigner: false, isWritable: true, pubkey: insuranceVaultPk },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    ...liqorOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];

  const data = encodeMangoInstruction({
    ResolvePerpBankruptcy: {
      liabIndex,
      maxLiabTransfer,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeResolveTokenBankruptcyInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoCachePk: PublicKey,
  liqeeMangoAccountPk: PublicKey,
  liqorMangoAccountPk: PublicKey,
  liqorPk: PublicKey,
  quoteRootBankPk: PublicKey,
  quoteNodeBankPk: PublicKey,
  quoteVaultPk: PublicKey,
  insuranceVaultPk: PublicKey,
  signerPk: PublicKey,
  liabRootBankPk: PublicKey,
  liabNodeBankPk: PublicKey,
  liqorOpenOrdersPks: PublicKey[],
  liabNodeBankPks: PublicKey[],
  maxLiabTransfer: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoCachePk },
    { isSigner: false, isWritable: true, pubkey: liqeeMangoAccountPk },
    { isSigner: false, isWritable: true, pubkey: liqorMangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: liqorPk },
    { isSigner: false, isWritable: false, pubkey: quoteRootBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteVaultPk },
    { isSigner: false, isWritable: true, pubkey: insuranceVaultPk },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: true, pubkey: liabRootBankPk },
    { isSigner: false, isWritable: true, pubkey: liabNodeBankPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    ...liqorOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
    ...liabNodeBankPks.map((pubkey) => ({
      isSigner: false,
      isWritable: true,
      pubkey,
    })),
  ];

  const data = encodeMangoInstruction({
    ResolveTokenBankruptcy: {
      maxLiabTransfer,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeRedeemMngoInstruction(
  programId: PublicKey,
  mangoGroup: PublicKey,
  mangoCache: PublicKey,
  mangoAccount: PublicKey,
  owner: PublicKey,
  perpMarket: PublicKey,
  mngoPerpVault: PublicKey,
  mngoRootBank: PublicKey,
  mngoNodeBank: PublicKey,
  mngoBankVault: PublicKey,
  signer: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroup },
    { isSigner: false, isWritable: false, pubkey: mangoCache },
    { isSigner: false, isWritable: true, pubkey: mangoAccount },
    { isSigner: true, isWritable: false, pubkey: owner },
    { isSigner: false, isWritable: false, pubkey: perpMarket },
    { isSigner: false, isWritable: true, pubkey: mngoPerpVault },
    { isSigner: false, isWritable: false, pubkey: mngoRootBank },
    { isSigner: false, isWritable: true, pubkey: mngoNodeBank },
    { isSigner: false, isWritable: true, pubkey: mngoBankVault },
    { isSigner: false, isWritable: false, pubkey: signer },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
  ];

  const data = encodeMangoInstruction({ RedeemMngo: {} });
  return new TransactionInstruction({ keys, data, programId });
}

export function makeAddMangoAccountInfoInstruction(
  programId: PublicKey,
  mangoGroup: PublicKey,
  mangoAccount: PublicKey,
  owner: PublicKey,
  info: string,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroup },
    { isSigner: false, isWritable: true, pubkey: mangoAccount },
    { isSigner: true, isWritable: false, pubkey: owner },
  ];
  // TODO convert info into a 32 byte utf encoded byte array
  const encoded = Buffer.from(info);
  if (encoded.length > INFO_LEN) {
    throw new Error(
      'info string too long. Must be less than or equal to 32 bytes',
    );
  }
  const infoArray = new Uint8Array(encoded, 0, INFO_LEN);
  const data = encodeMangoInstruction({
    AddMangoAccountInfo: { info: infoArray },
  });

  return new TransactionInstruction({ keys, data, programId });
}

export function makeDepositMsrmInstruction(
  programId: PublicKey,
  mangoGroup: PublicKey,
  mangoAccount: PublicKey,
  owner: PublicKey,
  msrmAccount: PublicKey,
  msrmVault: PublicKey,
  quantity: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroup },
    { isSigner: false, isWritable: true, pubkey: mangoAccount },
    { isSigner: true, isWritable: false, pubkey: owner },
    { isSigner: false, isWritable: true, pubkey: msrmAccount },
    { isSigner: false, isWritable: true, pubkey: msrmVault },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
  ];

  const data = encodeMangoInstruction({ DepositMsrm: { quantity } });
  return new TransactionInstruction({ keys, data, programId });
}
export function makeWithdrawMsrmInstruction(
  programId: PublicKey,
  mangoGroup: PublicKey,
  mangoAccount: PublicKey,
  owner: PublicKey,
  msrmAccount: PublicKey,
  msrmVault: PublicKey,
  signer: PublicKey,
  quantity: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroup },
    { isSigner: false, isWritable: true, pubkey: mangoAccount },
    { isSigner: true, isWritable: false, pubkey: owner },
    { isSigner: false, isWritable: true, pubkey: msrmAccount },
    { isSigner: false, isWritable: true, pubkey: msrmVault },
    { isSigner: false, isWritable: false, pubkey: signer },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
  ];

  const data = encodeMangoInstruction({ WithdrawMsrm: { quantity } });
  return new TransactionInstruction({ keys, data, programId });
}

export function makeChangePerpMarketParamsInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  perpMarketPk: PublicKey,
  adminPk: PublicKey,
  maintLeverage: I80F48 | undefined,
  initLeverage: I80F48 | undefined,
  liquidationFee: I80F48 | undefined,
  makerFee: I80F48 | undefined,
  takerFee: I80F48 | undefined,
  rate: I80F48 | undefined,
  maxDepthBps: I80F48 | undefined,
  targetPeriodLength: BN | undefined,
  mngoPerPeriod: BN | undefined,
  exp: BN | undefined,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];
  const data = encodeMangoInstruction({
    ChangePerpMarketParams: {
      maintLeverageOption: maintLeverage !== undefined,
      maintLeverage: maintLeverage !== undefined ? maintLeverage : ZERO_I80F48,
      initLeverageOption: initLeverage !== undefined,
      initLeverage: initLeverage !== undefined ? initLeverage : ZERO_I80F48,
      liquidationFeeOption: liquidationFee !== undefined,
      liquidationFee:
        liquidationFee !== undefined ? liquidationFee : ZERO_I80F48,
      makerFeeOption: makerFee !== undefined,
      makerFee: makerFee !== undefined ? makerFee : ZERO_I80F48,
      takerFeeOption: takerFee !== undefined,
      takerFee: takerFee !== undefined ? takerFee : ZERO_I80F48,
      rateOption: rate !== undefined,
      rate: rate !== undefined ? rate : ZERO_I80F48,
      maxDepthBpsOption: maxDepthBps !== undefined,
      maxDepthBps: maxDepthBps !== undefined ? maxDepthBps : ZERO_I80F48,
      targetPeriodLengthOption: targetPeriodLength !== undefined,
      targetPeriodLength:
        targetPeriodLength !== undefined ? targetPeriodLength : ZERO_BN,
      mngoPerPeriodOption: mngoPerPeriod !== undefined,
      mngoPerPeriod: mngoPerPeriod !== undefined ? mngoPerPeriod : ZERO_BN,
      expOption: exp !== undefined,
      exp: exp !== undefined ? exp : ZERO_BN,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}
export function makeChangePerpMarketParams2Instruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  perpMarketPk: PublicKey,
  adminPk: PublicKey,
  maintLeverage: I80F48 | undefined,
  initLeverage: I80F48 | undefined,
  liquidationFee: I80F48 | undefined,
  makerFee: I80F48 | undefined,
  takerFee: I80F48 | undefined,
  rate: I80F48 | undefined,
  maxDepthBps: I80F48 | undefined,
  targetPeriodLength: BN | undefined,
  mngoPerPeriod: BN | undefined,
  exp: BN | undefined,
  version: BN | undefined,
  lmSizeShift: BN | undefined,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];
  const data = encodeMangoInstruction({
    ChangePerpMarketParams2: {
      maintLeverageOption: maintLeverage !== undefined,
      maintLeverage: maintLeverage !== undefined ? maintLeverage : ZERO_I80F48,
      initLeverageOption: initLeverage !== undefined,
      initLeverage: initLeverage !== undefined ? initLeverage : ZERO_I80F48,
      liquidationFeeOption: liquidationFee !== undefined,
      liquidationFee:
        liquidationFee !== undefined ? liquidationFee : ZERO_I80F48,
      makerFeeOption: makerFee !== undefined,
      makerFee: makerFee !== undefined ? makerFee : ZERO_I80F48,
      takerFeeOption: takerFee !== undefined,
      takerFee: takerFee !== undefined ? takerFee : ZERO_I80F48,
      rateOption: rate !== undefined,
      rate: rate !== undefined ? rate : ZERO_I80F48,
      maxDepthBpsOption: maxDepthBps !== undefined,
      maxDepthBps: maxDepthBps !== undefined ? maxDepthBps : ZERO_I80F48,
      targetPeriodLengthOption: targetPeriodLength !== undefined,
      targetPeriodLength:
        targetPeriodLength !== undefined ? targetPeriodLength : ZERO_BN,
      mngoPerPeriodOption: mngoPerPeriod !== undefined,
      mngoPerPeriod: mngoPerPeriod !== undefined ? mngoPerPeriod : ZERO_BN,
      expOption: exp !== undefined,
      exp: exp !== undefined ? exp : ZERO_BN,
      versionOption: version !== undefined,
      version: version !== undefined ? version : ZERO_BN,
      lmSizeShiftOption: lmSizeShift !== undefined,
      lmSizeShift: lmSizeShift !== undefined ? lmSizeShift : ZERO_BN,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeSetGroupAdminInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  newAdminPk: PublicKey,
  adminPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: newAdminPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];
  const data = encodeMangoInstruction({
    SetGroupAdmin: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeRemoveAdvancedOrderInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  advancedOrdersPk: PublicKey,
  orderIndex: number,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: true, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: advancedOrdersPk },
    { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
  ];

  const data = encodeMangoInstruction({
    RemoveAdvancedOrder: { orderIndex },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeInitAdvancedOrdersInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  advancedOrdersPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: advancedOrdersPk },
    { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
  ];

  const data = encodeMangoInstruction({
    InitAdvancedOrders: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeAddPerpTriggerOrderInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  advancedOrdersPk: PublicKey,
  mangoCachePk: PublicKey,
  perpMarketPk: PublicKey,
  openOrders: PublicKey[],
  orderType: PerpOrderType,
  side: 'buy' | 'sell',
  price: BN,
  quantity: BN,
  triggerCondition: 'above' | 'below',
  triggerPrice: I80F48,
  reduceOnly?: boolean,
  clientOrderId?: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: true, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: advancedOrdersPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
    { isSigner: false, isWritable: false, pubkey: perpMarketPk },
    { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
    ...openOrders.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];
  const data = encodeMangoInstruction({
    AddPerpTriggerOrder: {
      price,
      quantity,
      clientOrderId,
      side,
      orderType,
      triggerCondition,
      triggerPrice,
      reduceOnly,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeExecutePerpTriggerOrderInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  advancedOrdersPk: PublicKey,
  agentPk: PublicKey,
  mangoCachePk: PublicKey,
  perpMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  eventQueuePk: PublicKey,
  openOrders: PublicKey[],
  orderIndex: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: false, isWritable: true, pubkey: advancedOrdersPk },
    { isSigner: true, isWritable: true, pubkey: agentPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    ...openOrders.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];
  const data = encodeMangoInstruction({
    ExecutePerpTriggerOrder: {
      orderIndex,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCloseMangoAccountInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: true, pubkey: ownerPk },
  ];

  const data = encodeMangoInstruction({
    CloseMangoAccount: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCloseSpotOpenOrdersInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  dexProgramPk: PublicKey,
  openOrdersPk: PublicKey,
  spotMarketPk: PublicKey,
  signerPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: true, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: dexProgramPk },
    { isSigner: false, isWritable: true, pubkey: openOrdersPk },
    { isSigner: false, isWritable: false, pubkey: spotMarketPk },
    { isSigner: false, isWritable: false, pubkey: signerPk },
  ];

  const data = encodeMangoInstruction({
    CloseSpotOpenOrders: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCloseAdvancedOrdersInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  advancedOrdersPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: true, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: advancedOrdersPk },
  ];

  const data = encodeMangoInstruction({
    CloseAdvancedOrders: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCreateDustAccountInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  payerPK: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: true, pubkey: payerPK },
    { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
  ];

  const data = encodeMangoInstruction({
    CreateDustAccount: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeResolveDustInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  dustAccountPk: PublicKey,
  rootBankPk: PublicKey,
  nodeBankPk: PublicKey,
  mangoCachePk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: dustAccountPk },
    { isSigner: false, isWritable: false, pubkey: rootBankPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
  ];

  const data = encodeMangoInstruction({
    ResolveDust: {},
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeUpdateMarginBasketInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  openOrdersPks: PublicKey[],
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    ...openOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: true,
      pubkey,
    })),
  ];
  const data = encodeMangoInstruction({
    UpdateMarginBasket: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCreateMangoAccountInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  accountNum: BN,
  payer: PublicKey,
) {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
    { isSigner: true, isWritable: true, pubkey: payer },
  ];
  const data = encodeMangoInstruction({
    CreateMangoAccount: {
      accountNum,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeUpgradeMangoAccountV0V1Instruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
) {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
  ];
  const data = encodeMangoInstruction({
    UpgradeMangoAccountV0V1: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeChangeMaxMangoAccountsInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  adminPk: PublicKey,
  maxMangoAccounts: BN,
) {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: mangoGroupPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];

  const data = encodeMangoInstruction({
    ChangeMaxMangoAccounts: {
      maxMangoAccounts,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCancelPerpOrdersSideInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  perpMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  side: 'buy' | 'sell',
  limit: BN,
) {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
  ];

  const data = encodeMangoInstruction({
    CancelPerpOrdersSide: {
      side,
      limit,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeSetDelegateInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  delegatePk: PublicKey,
) {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: delegatePk },
  ];

  const data = encodeMangoInstruction({
    SetDelegate: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeChangeSpotMarketParamsInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  spotMarketPk: PublicKey,
  rootBankPk: PublicKey,
  adminPk: PublicKey,
  maintLeverage: I80F48 | undefined,
  initLeverage: I80F48 | undefined,
  liquidationFee: I80F48 | undefined,
  optimalUtil: I80F48 | undefined,
  optimalRate: I80F48 | undefined,
  maxRate: I80F48 | undefined,
  version,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: spotMarketPk },
    { isSigner: false, isWritable: true, pubkey: rootBankPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];
  const data = encodeMangoInstruction({
    ChangeSpotMarketParams: {
      maintLeverageOption: maintLeverage !== undefined,
      maintLeverage: maintLeverage != undefined ? maintLeverage : ZERO_I80F48,
      initLeverageOption: initLeverage !== undefined,
      initLeverage: initLeverage != undefined ? initLeverage : ZERO_I80F48,
      liquidationFeeOption: liquidationFee !== undefined,
      liquidationFee:
        liquidationFee != undefined ? liquidationFee : ZERO_I80F48,
      optimalUtilOption: optimalUtil !== undefined,
      optimalUtil: optimalUtil != undefined ? optimalUtil : ZERO_I80F48,
      optimalRateOption: optimalRate !== undefined,
      optimalRate: optimalRate != undefined ? optimalRate : ZERO_I80F48,
      maxRateOption: maxRate !== undefined,
      maxRate: maxRate != undefined ? maxRate : ZERO_I80F48,
      versionOption: version !== undefined,
      version: version != undefined ? version : ZERO_BN,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeChangeReferralFeeParamsInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  adminPk: PublicKey,
  refSurchargeCentibps: BN,
  refShareCentibps: BN,
  refMngoRequired: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: mangoGroupPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];

  const data = encodeMangoInstruction({
    ChangeReferralFeeParams: {
      refSurchargeCentibps,
      refShareCentibps,
      refMngoRequired,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeSetReferrerMemoryInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoAccountPk: PublicKey,
  ownerPk: PublicKey,
  referrerMemoryPk: PublicKey,
  referrerMangoAccountPk: PublicKey,
  payerPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: referrerMemoryPk },
    { isSigner: false, isWritable: false, pubkey: referrerMangoAccountPk },
    { isSigner: true, isWritable: true, pubkey: payerPk },
    { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
  ];

  const data = encodeMangoInstruction({
    SetReferrerMemory: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeRegisterReferrerIdInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  referrerMangoAccountPk: PublicKey,
  referrerIdRecordPk: PublicKey,
  payerPk: PublicKey,
  referrerId: Buffer,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: referrerMangoAccountPk },
    { isSigner: false, isWritable: true, pubkey: referrerIdRecordPk },
    { isSigner: true, isWritable: true, pubkey: payerPk },
    { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
  ];

  const data = encodeMangoInstruction({
    RegisterReferrerId: { referrerId },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCancelAllSpotOrdersInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  mangoCachePk: PublicKey,
  mangoAccountPk: PublicKey,
  owner: PublicKey,
  baseRootBankPk: PublicKey,
  baseNodeBankPk: PublicKey,
  baseVaultPk: PublicKey,
  quoteRootBankPk: PublicKey,
  quoteNodeBankPk: PublicKey,
  quoteVaultPk: PublicKey,
  spotMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  openOrders: PublicKey,
  signerPk: PublicKey,
  dexEventQueuePk: PublicKey,
  dexBasePk: PublicKey,
  dexQuotePk: PublicKey,
  dexSignerPk: PublicKey,
  dexProgramPk: PublicKey,
  limit: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: owner },
    { isSigner: false, isWritable: false, pubkey: baseRootBankPk },
    { isSigner: false, isWritable: true, pubkey: baseNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: baseVaultPk },
    { isSigner: false, isWritable: false, pubkey: quoteRootBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteVaultPk },
    { isSigner: false, isWritable: true, pubkey: spotMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: true, pubkey: openOrders },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: true, pubkey: dexEventQueuePk },
    { isSigner: false, isWritable: true, pubkey: dexBasePk },
    { isSigner: false, isWritable: true, pubkey: dexQuotePk },
    { isSigner: false, isWritable: false, pubkey: dexSignerPk },
    { isSigner: false, isWritable: false, pubkey: dexProgramPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
  ];

  const data = encodeMangoInstruction({
    CancelAllSpotOrders: {
      limit,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}
