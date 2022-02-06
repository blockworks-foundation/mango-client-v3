import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';

import { BinaryReader, Schema, BorshError, BinaryWriter } from 'borsh';
import { I80F48 } from '../utils/fixednum';

(BinaryReader.prototype as any).readPubkey = function () {
  const reader = this as unknown as BinaryReader;
  const array = reader.readFixedArray(32);
  return new PublicKey(array);
};

(BinaryWriter.prototype as any).writePubkey = function (value: PublicKey) {
  const writer = this as unknown as BinaryWriter;
  writer.writeFixedArray(value.toBuffer());
};

(BinaryReader.prototype as any).readI80F48 = function () {
  const reader = this as unknown as BinaryReader;
  const array = reader.readFixedArray(16);
  const result = new BN(array, 10, 'le').fromTwos(128);
  return new I80F48(result);
};
(BinaryReader.prototype as any).writeI80F48 = function (value: I80F48) {
  const writer = this as unknown as BinaryWriter;
  writer.writeFixedArray(value.toArray());
};

(BinaryReader.prototype as any).readI64 = function () {
  const reader = this as unknown as BinaryReader;
  const array = reader.readFixedArray(8);
  return new BN(array, 10, 'le').fromTwos(64);
};

(BinaryReader.prototype as any).writeI64 = function (value: BN) {
  const writer = this as unknown as BinaryWriter;
  writer.writeFixedArray(value.toBuffer('le', 8));
};

(BinaryReader.prototype as any).readI128 = function () {
  const reader = this as unknown as BinaryReader;
  const array = reader.readFixedArray(16);
  return new BN(array, 10, 'le').fromTwos(128);
};
(BinaryReader.prototype as any).writeI128 = function (value: BN) {
  const writer = this as unknown as BinaryWriter;
  writer.writeFixedArray(value.toBuffer('le', 16));
};

function capitalizeFirstLetter(string: string): string {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function deserializeField(
  schema: Schema,
  fieldName: string,
  fieldType: any,
  reader: BinaryReader,
): any {
  try {
    console.log(fieldName, fieldType);
    if (typeof fieldType === 'string') {
      return (reader as any)[`read${capitalizeFirstLetter(fieldType)}`]();
    }

    if (fieldType instanceof Array) {
      if (typeof fieldType[0] === 'number') {
        return reader.readFixedArray(fieldType[0]);
      }

      return reader.readArray(() =>
        deserializeField(schema, fieldName, fieldType[0], reader),
      );
    }

    if (fieldType.kind === 'option') {
      const option = reader.readU8();
      if (option) {
        return deserializeField(schema, fieldName, fieldType.type, reader);
      }

      return undefined;
    }

    return deserializeStruct(schema, fieldType, reader);
  } catch (error) {
    if (error instanceof BorshError) {
      error.addToFieldPath(fieldName);
    }
    throw error;
  }
}

function deserializeStruct(
  schema: Schema,
  classType: any,
  reader: BinaryReader,
) {
  const structSchema = schema.get(classType);
  if (!structSchema) {
    throw new BorshError(`Class ${classType.name} is missing in schema`);
  }

  if (structSchema.kind === 'struct') {
    const result: any = {};
    for (const [fieldName, fieldType] of schema.get(classType).fields) {
      result[fieldName] = deserializeField(
        schema,
        fieldName,
        fieldType,
        reader,
      );
    }
    return new classType(result);
  }

  if (structSchema.kind === 'enum') {
    const idx = reader.readU8();
    if (idx >= structSchema.values.length) {
      throw new BorshError(`Enum index: ${idx} is out of range`);
    }
    const [fieldName, fieldType] = structSchema.values[idx];
    const fieldValue = deserializeField(schema, fieldName, fieldType, reader);
    return new classType({ [fieldName]: fieldValue });
  }

  throw new BorshError(
    `Unexpected schema kind: ${structSchema.kind} for ${classType.constructor.name}`,
  );
}

/// Deserializes object from bytes using schema.
export function deserializeBorsh(
  schema: Schema,
  classType: any,
  buffer: Buffer,
): any {
  const reader = new BinaryReader(buffer);
  return deserializeStruct(schema, classType, reader);
}

export class LoggableFillEvent {
  eventType!: number;
  takerSide!: number;
  makerSlot!: number;
  makerOut!: boolean;
  timestamp!: BN;
  seqNum!: BN;

  maker!: PublicKey;
  makerOrderId!: BN;
  makerClientOrderId!: BN;
  makerFee!: I80F48;
  bestInitial!: BN;
  makerTimestamp!: BN; // this is timestamp of maker order not timestamp of trade

  taker!: PublicKey;
  takerOrderId!: BN;
  takerClientOrderId!: BN;
  takerFee!: I80F48;

  price!: BN;
  quantity!: BN;

  constructor(decoded: any) {
    Object.assign(this, decoded);
  }
}

export const LOGGABLE_SCHEMA = new Map<any, any>([
  [
    LoggableFillEvent,
    {
      kind: 'struct',
      fields: [
        ['eventType', 'u8'],
        ['takerSide', 'u8'],
        ['makerSlot', 'u8'],
        ['makerOut', 'u8'],
        ['timestamp', 'u64'],
        ['seqNum', 'u64'],
        ['maker', 'pubkey'],
        ['makerOrderId', 'i128'],
        ['makerClientOrderId', 'u64'],
        ['makerFee', 'I80F48'],
        ['bestInitial', 'i64'],
        ['makerTimestamp', 'u64'],

        ['taker', 'pubkey'],
        ['takerOrderId', 'i128'],
        ['takerClientOrderId', 'u64'],
        ['takerFee', 'I80F48'],
        ['price', 'i64'],
        ['quantity', 'i64'],
      ],
    },
  ],
]);
