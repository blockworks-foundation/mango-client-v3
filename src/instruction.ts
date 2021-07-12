import {
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from '@solana/web3.js';
import { encodeMangoInstruction, AssetType } from './layout';
import BN from 'bn.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Order } from '@project-serum/serum/lib/market';
import { I80F48 } from './fixednum';
import { PerpOrder } from '.';

export function makeInitMangoGroupInstruction(
  programId: PublicKey,
  mangoGroupPk: PublicKey,
  signerKey: PublicKey,
  payerPk: PublicKey,
  quoteMintPk: PublicKey,
  quoteVaultPk: PublicKey,
  quoteNodeBankPk: PublicKey,
  quoteRootBankPk: PublicKey,
  daoVaultPk: PublicKey,
  msrmVaultPk: PublicKey,
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
    { isSigner: false, isWritable: false, pubkey: daoVaultPk },
    { isSigner: false, isWritable: false, pubkey: msrmVaultPk },
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

export function makeTestMultiTxInstruction(
  programId: PublicKey,
  mangoGroup: PublicKey,
  index: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: mangoGroup },
    { isSigner: false, isWritable: false, pubkey: SYSVAR_CLOCK_PUBKEY },
  ];

  const data = encodeMangoInstruction({
    TestMultiTx: { index },
  });

  return new TransactionInstruction({ keys, data, programId });
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
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
  ];

  const data = encodeMangoInstruction({
    CancelPerpOrder: {
      orderId: order.orderId,
      side: order.side,
    },
  });

  console.log(order, order.orderId.toArray(), data);

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
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
  ];

  const data = encodeMangoInstruction({
    CancelPerpOrderByClientId: {
      clientOrderId,
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
    { isSigner: false, isWritable: false, pubkey: merpsCachePk },
    { isSigner: false, isWritable: false, pubkey: rootBankPk },
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
  spotMarketPk: PublicKey,
  serumDexPk: PublicKey,
  mintPk: PublicKey,
  nodeBankPk: PublicKey,
  vaultPk: PublicKey,
  rootBankPk: PublicKey,
  adminPk: PublicKey,

  marketIndex: BN,
  maintLeverage: I80F48,
  initLeverage: I80F48,
  optimalUtil: I80F48,
  optimalRate: I80F48,
  maxRate: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: mangoGroupPk },
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
      marketIndex,
      maintLeverage,
      initLeverage,
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

// export function makeAddToBasketInstruction(
//   programId: PublicKey,
//   mangoGroupPk: PublicKey,
//   mangoAccountPk: PublicKey,
//   ownerPk: PublicKey,
//   marketIndex: BN,
// ): TransactionInstruction {
//   const keys = [
//     { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
//     { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
//     { isSigner: true, isWritable: false, pubkey: ownerPk },
//   ];
//
//   const data = encodeMangoInstruction({
//     AddToBasket: { marketIndex },
//   });
//
//   return new TransactionInstruction({
//     keys,
//     data,
//     programId,
//   });
// }

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
  quoteRootBankPk: PublicKey,
  quoteNodeBankPk: PublicKey,
  quoteVaultPk: PublicKey,
  baseVaultPk: PublicKey,
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
    { isSigner: false, isWritable: true, pubkey: quoteRootBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteVaultPk },
    { isSigner: false, isWritable: true, pubkey: baseVaultPk },
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
  rootBankPk: PublicKey,
  nodeBanks: PublicKey[],
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
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
    { isSigner: false, isWritable: false, pubkey: oraclePk },
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
    { isSigner: false, isWritable: true, pubkey: mangoGroupPk },
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
  perpMarketPk: PublicKey,
  eventQueuePk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  mngoVaultPk: PublicKey,
  adminPk: PublicKey,
  marketIndex: BN,
  maintLeverage: I80F48,
  initLeverage: I80F48,
  makerFee: I80F48,
  takerFee: I80F48,
  baseLotSize: BN,
  quoteLotSize: BN,
  maxDepthBps: I80F48,
  scaler: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: false, pubkey: mngoVaultPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];
  const data = encodeMangoInstruction({
    AddPerpMarket: {
      marketIndex,
      maintLeverage,
      initLeverage,
      makerFee,
      takerFee,
      baseLotSize,
      quoteLotSize,
      maxDepthBps,
      scaler,
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
  perpMarketPk: PublicKey,
  eventQueuePk: PublicKey,
  mangoAccountPks: PublicKey[],
  limit: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    ...mangoAccountPks.map((pubkey) => ({
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
  orderType?: 'limit' | 'ioc' | 'postOnly',
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
  const data = encodeMangoInstruction({
    PlacePerpOrder: {
      price,
      quantity,
      clientOrderId,
      side,
      orderType,
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
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
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
  liqeeOpenOrdersPks: PublicKey[],
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
    { isSigner: true, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: true, pubkey: dexEventQueuePk },
    { isSigner: false, isWritable: true, pubkey: dexBasePk },
    { isSigner: false, isWritable: true, pubkey: dexQuotePk },
    { isSigner: false, isWritable: false, pubkey: dexSignerPk },
    { isSigner: false, isWritable: false, pubkey: dexProgramPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    ...liqeeOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
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
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
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
  maxLiabTransfer: BN,
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
  maxLiabTransfer: BN,
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
  daoVaultPk: PublicKey,
  signerPk: PublicKey,
  adminPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: mangoGroupPk },
    { isSigner: false, isWritable: false, pubkey: mangoCachePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: mangoAccountPk },
    { isSigner: false, isWritable: false, pubkey: rootBankPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    { isSigner: false, isWritable: true, pubkey: bankVaultPk },
    { isSigner: false, isWritable: true, pubkey: daoVaultPk },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
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
  daoVaultPk: PublicKey,
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
    { isSigner: false, isWritable: true, pubkey: daoVaultPk },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: false, pubkey: perpMarketPk },
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
  daoVaultPk: PublicKey,
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
    { isSigner: false, isWritable: true, pubkey: daoVaultPk },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: false, pubkey: liabRootBankPk },
    { isSigner: false, isWritable: true, pubkey: liabNodeBankPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    ...liqorOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
    ...liabNodeBankPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
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
