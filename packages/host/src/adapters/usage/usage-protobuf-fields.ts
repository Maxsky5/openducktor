/**
 * One field of a protocol buffer message as it is on the wire. A varint holds a number, and a
 * length-delimited field holds its bytes. The reader keeps no other wire types.
 */
export type ProtobufField =
  | { readonly number: number; readonly kind: "varint"; readonly value: number }
  | { readonly number: number; readonly kind: "bytes"; readonly value: Uint8Array };

const textDecoder = new TextDecoder();

/** Reads a varint at `offset`. Values above 2^53 lose precision; no reader uses them. */
const readVarint = (buffer: Uint8Array, offset: number): { value: number; next: number } | null => {
  let value = 0;
  let scale = 1;
  for (let index = offset; index < buffer.length && index < offset + 10; index++) {
    const byte = buffer[index] ?? 0;
    value += (byte & 0x7f) * scale;
    if (byte < 0x80) return { value, next: index + 1 };
    scale *= 128;
  }
  return null;
};

/**
 * Reads the fields of a protocol buffer message without its schema. Returns null for bytes that
 * are not a message: a cut field or an unknown wire type.
 */
export const readProtobufFields = (buffer: Uint8Array): ProtobufField[] | null => {
  const fields: ProtobufField[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const key = readVarint(buffer, offset);
    if (key === null) return null;
    const number = Math.floor(key.value / 8);
    const wireType = key.value % 8;
    offset = key.next;
    if (number === 0) return null;
    if (wireType === 0) {
      const varint = readVarint(buffer, offset);
      if (varint === null) return null;
      fields.push({ number, kind: "varint", value: varint.value });
      offset = varint.next;
    } else if (wireType === 2) {
      const length = readVarint(buffer, offset);
      if (length === null || length.next + length.value > buffer.length) return null;
      fields.push({
        number,
        kind: "bytes",
        value: buffer.subarray(length.next, length.next + length.value),
      });
      offset = length.next + length.value;
    } else if (wireType === 1 || wireType === 5) {
      // Fixed-width numbers carry nothing that a reader uses.
      offset += wireType === 1 ? 8 : 4;
      if (offset > buffer.length) return null;
    } else return null;
  }
  return fields;
};

/** The varints of a packed repeated field. */
export const readPackedVarints = (buffer: Uint8Array): number[] | null => {
  const values: number[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const varint = readVarint(buffer, offset);
    if (varint === null) return null;
    values.push(varint.value);
    offset = varint.next;
  }
  return values;
};

/** The last varint of a field number, as a protocol buffer reader keeps it. */
export const varintOf = (fields: readonly ProtobufField[], number: number): number | null => {
  let value: number | null = null;
  for (const field of fields)
    if (field.number === number && field.kind === "varint") value = field.value;
  return value;
};

/** The bytes of each occurrence of a length-delimited field number. */
export const bytesOf = (fields: readonly ProtobufField[], number: number): Uint8Array[] =>
  fields.flatMap((field) =>
    field.number === number && field.kind === "bytes" ? [field.value] : [],
  );

/** The fields of the first occurrence of a message field, or null. */
export const messageOf = (
  fields: readonly ProtobufField[],
  number: number,
): ProtobufField[] | null => {
  const [bytes] = bytesOf(fields, number);
  return bytes === undefined ? null : readProtobufFields(bytes);
};

/** The text of the first occurrence of a string field, or null. */
export const textOf = (fields: readonly ProtobufField[], number: number): string | null => {
  const [bytes] = bytesOf(fields, number);
  return bytes === undefined ? null : textDecoder.decode(bytes);
};

/** The instant of a `google.protobuf.Timestamp` message, in milliseconds. */
export const timestampMsOf = (fields: readonly ProtobufField[] | null): number | null => {
  const seconds = fields === null ? null : varintOf(fields, 1);
  if (fields === null || seconds === null) return null;
  return seconds * 1000 + Math.floor((varintOf(fields, 2) ?? 0) / 1_000_000);
};
