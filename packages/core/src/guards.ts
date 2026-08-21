import type { JsonValue } from "@openducktor/contracts";

export type UnknownRecord = Record<string, JsonValue>;

export const isUnknownRecord = (value: JsonValue | undefined): value is UnknownRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const isRecord = isUnknownRecord;
