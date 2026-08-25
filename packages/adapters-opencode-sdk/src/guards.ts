import { isUnknownRecord, type UnknownRecord } from "@openducktor/core";

export type { UnknownRecord } from "@openducktor/core";

export const asUnknownRecord = (value: unknown): UnknownRecord | undefined => {
  return isUnknownRecord(value) ? value : undefined;
};

const safeProp = <T>(
  source: UnknownRecord,
  key: string,
  guard: (value: unknown) => value is T,
): T | undefined => {
  const value = source[key];
  if (value === undefined) {
    return undefined;
  }
  return guard(value) ? value : undefined;
};

export const readRecordProp = (source: unknown, key: string): UnknownRecord | undefined => {
  const record = asUnknownRecord(source);
  return record ? safeProp(record, key, isUnknownRecord) : undefined;
};

export const readArrayProp = (source: unknown, key: string): unknown[] | undefined => {
  const record = asUnknownRecord(source);
  return record ? safeProp(record, key, Array.isArray) : undefined;
};

export const readStringProp = (source: unknown, keys: readonly string[]): string | undefined => {
  const record = asUnknownRecord(source);
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
  const record = asUnknownRecord(source);
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
  const record = asUnknownRecord(source);
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
  const record = asUnknownRecord(source);
  const values = record ? safeProp(record, key, Array.isArray) : undefined;
  if (!values) {
    return undefined;
  }

  const stringArray: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      return undefined;
    }
    stringArray.push(value);
  }
  return stringArray;
};
