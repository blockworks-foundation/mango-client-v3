import { PublicKey, SYSVAR_CLOCK_PUBKEY, TransactionInstruction } from '@solana/web3.js';
import { encodeMerpsInstruction } from './layout';
import BN from 'bn.js';

export function makeInitMerpsGroupInstruction(
  programId: PublicKey,
  merpsGroup: PublicKey,
  validInterval: number
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: merpsGroup },
  ];

  const data = encodeMerpsInstruction({
    InitMerpsGroup: { validInterval: new BN(validInterval) },
  });
  return new TransactionInstruction({ keys, data, programId });
}

export function makeTestMultiTxInstruction(
  programId: PublicKey,
  merpsGroup: PublicKey,
  index: number
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: merpsGroup },
    { isSigner: false, isWritable: false, pubkey: SYSVAR_CLOCK_PUBKEY },
  ];

  const data = encodeMerpsInstruction({
    TestMultiTx: {index: new BN(index)},
  });

  return new TransactionInstruction({ keys, data, programId });
}