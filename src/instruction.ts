import {
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  TransactionInstruction,
} from '@solana/web3.js';
import { encodeMerpsInstruction } from './layout';
import BN from 'bn.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

export function makeInitMerpsGroupInstruction(
  programId: PublicKey,
  merpsGroup: PublicKey,
  validInterval: number,
): TransactionInstruction {
  const keys = [{ isSigner: false, isWritable: true, pubkey: merpsGroup }];

  const data = encodeMerpsInstruction({
    InitMerpsGroup: { validInterval: new BN(validInterval) },
  });
  return new TransactionInstruction({ keys, data, programId });
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
  oracles: PublicKey[],

  nativeQuantity: BN,
): TransactionInstruction {
  const withdrawKeys = [
    { isSigner: false, isWritable: true, pubkey: merpsGroupPk },
    { isSigner: false, isWritable: true, pubkey: merpsAccountPk },
    { isSigner: true, isWritable: false, pubkey: walletPk },
    { isSigner: true, isWritable: false, pubkey: merpsCachePk },
    { isSigner: true, isWritable: false, pubkey: rootBankPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    { isSigner: false, isWritable: true, pubkey: vaultPk },
    { isSigner: false, isWritable: true, pubkey: tokenAccPk },
    { isSigner: false, isWritable: false, pubkey: signerKey },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    ...oracles.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];
  const withdrawData = encodeMerpsInstruction({
    Withdraw: { quantity: nativeQuantity },
  });
  return new TransactionInstruction({
    keys: withdrawKeys,
    data: withdrawData,
    programId,
  });
}
