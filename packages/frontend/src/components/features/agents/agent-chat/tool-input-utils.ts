import type { JsonObject, JsonValue } from "@openducktor/contracts";
import { z } from "zod";

const stringValueSchema = z.string();
const isStringValue = (value: JsonValue | undefined): value is string =>
  stringValueSchema.safeParse(value).success;

export const readInputString = (input: JsonObject | undefined, keys: string[]): string | null => {
  if (!input) {
    return null;
  }
  for (const key of keys) {
    const value = input[key];
    if (isStringValue(value) && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

export const extractPathFromInput = (input: JsonObject | undefined): string | null => {
  const candidate =
    input?.filePath ?? input?.file_path ?? input?.path ?? input?.file ?? input?.filename;
  if (isStringValue(candidate)) {
    const normalized = candidate.trim();
    if (normalized.length > 0 && normalized !== ".") {
      return normalized;
    }
  }
  return null;
};
