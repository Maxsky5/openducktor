import { isJsonObject, type JsonObject, type JsonValue } from "@openducktor/contracts";
import { z } from "zod";

export const asJsonObject = (value: JsonValue | undefined): JsonObject | undefined => {
  return value !== undefined && isJsonObject(value) ? value : undefined;
};

export const readRecordProp = (
  source: JsonValue | undefined,
  key: string,
): JsonObject | undefined => {
  const record = asJsonObject(source);
  const value = record?.[key];
  return value === undefined ? undefined : asJsonObject(value);
};

export const readArrayProp = (
  source: JsonValue | undefined,
  key: string,
): JsonValue[] | undefined => {
  const record = asJsonObject(source);
  const value = record?.[key];
  return Array.isArray(value) ? value : undefined;
};

export const readStringProp = (
  source: JsonValue | undefined,
  keys: readonly string[],
): string | undefined => {
  const record = asJsonObject(source);
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = z.string().safeParse(record[key]);
    if (value.success && value.data.length > 0) {
      return value.data;
    }
  }
  return undefined;
};

export const readNumberProp = (
  source: JsonValue | undefined,
  keys: string[],
): number | undefined => {
  const record = asJsonObject(source);
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = z.number().finite().safeParse(record[key]);
    if (value.success) {
      return value.data;
    }
  }
  return undefined;
};

export const readBooleanProp = (
  source: JsonValue | undefined,
  keys: string[],
): boolean | undefined => {
  const record = asJsonObject(source);
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = z.boolean().safeParse(record[key]);
    if (value.success) {
      return value.data;
    }
  }
  return undefined;
};

export const readStringArrayProp = (
  source: JsonValue | undefined,
  key: string,
): string[] | undefined => {
  const record = asJsonObject(source);
  const values = z.array(z.string()).safeParse(record?.[key]);
  return values.success ? values.data : undefined;
};
