import { z } from "zod";

export type UnknownRecord = Record<string, unknown>;

const unknownRecordSchema = z.record(z.string(), z.unknown());

export const asUnknownRecord = (value: unknown): UnknownRecord | undefined => {
  const parsed = unknownRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const safeProp = <T>(
  source: unknown,
  key: string,
  guard: (value: unknown) => value is T,
): T | undefined => {
  const parsed = unknownRecordSchema.safeParse(source);
  const record = parsed.success ? parsed.data : undefined;
  if (!record) {
    return undefined;
  }
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  return guard(value) ? value : undefined;
};

export const readRecordProp = (source: unknown, key: string): UnknownRecord | undefined => {
  const parsed = unknownRecordSchema.safeParse(source);
  return parsed.success
    ? safeProp(
        parsed.data,
        key,
        (value): value is UnknownRecord => unknownRecordSchema.safeParse(value).success,
      )
    : undefined;
};

export const readArrayProp = (source: unknown, key: string): unknown[] | undefined => {
  const parsed = unknownRecordSchema.safeParse(source);
  return parsed.success ? safeProp(parsed.data, key, Array.isArray) : undefined;
};

export const readStringProp = (source: unknown, keys: readonly string[]): string | undefined => {
  const parsed = unknownRecordSchema.safeParse(source);
  const record = parsed.success ? parsed.data : undefined;
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
};

export const readNumberProp = (source: unknown, keys: string[]): number | undefined => {
  const parsed = unknownRecordSchema.safeParse(source);
  const record = parsed.success ? parsed.data : undefined;
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && !Number.isNaN(value)) {
      return value;
    }
  }
  return undefined;
};

export const readBooleanProp = (source: unknown, keys: string[]): boolean | undefined => {
  const parsed = unknownRecordSchema.safeParse(source);
  const record = parsed.success ? parsed.data : undefined;
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
};

export const readStringArrayProp = (source: unknown, key: string): string[] | undefined => {
  const parsed = unknownRecordSchema.safeParse(source);
  const values = parsed.success ? readArrayProp(parsed.data, key) : undefined;
  if (!values) {
    return undefined;
  }

  const stringArray: string[] = [];
  for (const value of values) {
    if (!(typeof value === "string")) {
      return undefined;
    }
    stringArray.push(value);
  }
  return stringArray;
};
