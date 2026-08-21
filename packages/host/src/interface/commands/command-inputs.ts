import { HostValidationError } from "../../effect/host-errors";
import type { JsonValue } from "@openducktor/contracts";

const invalidInput = (message: string, field?: string): HostValidationError =>
  new HostValidationError({
    message,
    field,
  });

export const requireRecord = (
  value: JsonValue | undefined,
  label: string,
): Record<string, JsonValue> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput(`${label} must be an object.`, label);
  }

  return value as Record<string, JsonValue>;
};

export const requireString = (value: JsonValue | undefined, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidInput(`${label} is required.`, label);
  }

  return value.trim();
};

export const requireStringPreservingWhitespace = (
  value: JsonValue | undefined,
  label: string,
): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidInput(`${label} is required.`, label);
  }

  return value;
};

export const optionalString = (value: JsonValue | undefined, label: string): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw invalidInput(`${label} must be a string when provided.`, label);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const optionalBoolean = (
  value: JsonValue | undefined,
  label: string,
): boolean | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw invalidInput(`${label} must be a boolean when provided.`, label);
  }

  return value;
};
