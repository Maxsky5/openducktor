import { hasRuntimeType } from "@openducktor/contracts";
import type { JsonValue } from "@openducktor/contracts";

export type UnknownRecord = Record<string, JsonValue>;

const isJsonRecord = (value: JsonValue | undefined): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const asUnknownRecord = (value: JsonValue | undefined): UnknownRecord | undefined => {
  return isJsonRecord(value) ? value : undefined;
};

const safeProp = <T extends JsonValue>(
  source: JsonValue | undefined,
  key: string,
  guard: (value: JsonValue) => value is T,
): T | undefined => {
  const record = asUnknownRecord(source);
  if (!record) {
    return undefined;
  }
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  return guard(value) ? value : undefined;
};

export const readUnknownProp = (
  source: JsonValue | undefined,
  key: string,
): JsonValue | undefined => {
  const record = asUnknownRecord(source);
  return record?.[key];
};

export const readRecordProp = (
  source: JsonValue | undefined,
  key: string,
): UnknownRecord | undefined => {
  return safeProp(source, key, isJsonRecord);
};

export const readArrayProp = (
  source: JsonValue | undefined,
  key: string,
): JsonValue[] | undefined => {
  return safeProp(source, key, Array.isArray);
};

export const readStringProp = (
  source: JsonValue | undefined,
  keys: readonly string[],
): string | undefined => {
  const record = asUnknownRecord(source);
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = record[key];
    if (hasRuntimeType(value, "string") && value.length > 0) {
      return value;
    }
  }
  return undefined;
};

export const readNumberProp = (
  source: JsonValue | undefined,
  keys: string[],
): number | undefined => {
  const record = asUnknownRecord(source);
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = record[key];
    if (hasRuntimeType(value, "number") && Number.isFinite(value) && !Number.isNaN(value)) {
      return value;
    }
  }
  return undefined;
};

export const readBooleanProp = (
  source: JsonValue | undefined,
  keys: string[],
): boolean | undefined => {
  const record = asUnknownRecord(source);
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = record[key];
    if (hasRuntimeType(value, "boolean")) {
      return value;
    }
  }
  return undefined;
};

export const readStringArrayProp = (
  source: JsonValue | undefined,
  key: string,
): string[] | undefined => {
  const values = readArrayProp(source, key);
  if (!values) {
    return undefined;
  }

  const stringArray: string[] = [];
  for (const value of values) {
    if (!hasRuntimeType(value, "string")) {
      return undefined;
    }
    stringArray.push(value);
  }
  return stringArray;
};
