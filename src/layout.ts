import { struct, u32, u8, union } from 'buffer-layout';


export const MerpsInstructionLayout = union(u32('instruction'))
MerpsInstructionLayout.addVariant(0, struct([u8('validInterval')]), 'InitMerpsGroup')
MerpsInstructionLayout.addVariant(1, struct([u8('index')]), 'TestMultiTx')
// @ts-ignore
const instructionMaxSpan = Math.max(...Object.values(MerpsInstructionLayout.registry).map((r) => r.span));
export function encodeMerpsInstruction(data) {
  const b = Buffer.alloc(instructionMaxSpan);
  const span = MerpsInstructionLayout.encode(data, b);
  return b.slice(0, span);
}
