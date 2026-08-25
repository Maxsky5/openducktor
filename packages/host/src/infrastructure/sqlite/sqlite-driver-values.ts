export type SqliteValue = bigint | number | string | null | Uint8Array;
export type SqliteRow = Record<string, SqliteValue>;
export type SqliteValueRow = SqliteValue[];

export type SqliteRunResult = {
  changes: bigint | number;
  lastInsertRowid: bigint | number;
};

export const isSqliteValue = (value: unknown): value is SqliteValue =>
  value === null ||
  typeof value === "bigint" ||
  typeof value === "number" ||
  typeof value === "string" ||
  value instanceof Uint8Array;

export const isSqliteRow = (value: unknown): value is SqliteRow => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: object | null = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every(isSqliteValue);
};

export const isSqliteRunResult = (value: unknown): value is SqliteRunResult => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (!("changes" in value) || !("lastInsertRowid" in value)) return false;
  return (
    (typeof value.changes === "bigint" || typeof value.changes === "number") &&
    (typeof value.lastInsertRowid === "bigint" || typeof value.lastInsertRowid === "number")
  );
};
