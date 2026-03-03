export type UnknownRecord = Record<string, unknown>;

export const isUnknownRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isRecord = isUnknownRecord;
