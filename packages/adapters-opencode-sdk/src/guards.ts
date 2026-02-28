export type UnknownRecord = Record<string, unknown>;

export const isUnknownRecord = (value: unknown): value is UnknownRecord => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const asUnknownRecord = (value: unknown): UnknownRecord | undefined => {
  return isUnknownRecord(value) ? value : undefined;
};

export const safeProp = <T>(
  source: unknown,
  key: string,
  guard: (value: unknown) => value is T,
): T | undefined => {
  const record = asUnknownRecord(source);
  if (!record) {
    return undefined;
  }
  const value = record[key];
  return guard(value) ? value : undefined;
};

export const readUnknownProp = (source: unknown, key: string): unknown => {
  const record = asUnknownRecord(source);
  return record?.[key];
};

export const readRecordProp = (source: unknown, key: string): UnknownRecord | undefined => {
  return safeProp(source, key, isUnknownRecord);
};

export const readArrayProp = (source: unknown, key: string): unknown[] | undefined => {
  return safeProp(source, key, Array.isArray);
};

export const readStringProp = (source: unknown, keys: string[]): string | undefined => {
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
  const values = readArrayProp(source, key);
  if (!values) {
    return undefined;
  }
  if (!values.every((entry) => typeof entry === "string")) {
    return undefined;
  }
  return values;
};
