import { hasRuntimeType } from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";

const invalidInput = (message: string, field?: string): HostValidationError =>
  new HostValidationError({
    message,
    field,
  });

export const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || !hasRuntimeType(value, "object") || Array.isArray(value)) {
    throw invalidInput(`${label} must be an object.`, label);
  }

  // SAFETY: The preceding runtime guard establishes `Record<string, unknown>` before this assertion.
  return value as Record<string, unknown>;
};

export const requireString = (value: unknown, label: string): string => {
  if (!hasRuntimeType(value, "string") || value.trim().length === 0) {
    throw invalidInput(`${label} is required.`, label);
  }

  return value.trim();
};

export const requireStringPreservingWhitespace = (value: unknown, label: string): string => {
  if (!hasRuntimeType(value, "string") || value.trim().length === 0) {
    throw invalidInput(`${label} is required.`, label);
  }

  return value;
};

export const optionalString = (value: unknown, label: string): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!hasRuntimeType(value, "string")) {
    throw invalidInput(`${label} must be a string when provided.`, label);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const optionalBoolean = (value: unknown, label: string): boolean | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!hasRuntimeType(value, "boolean")) {
    throw invalidInput(`${label} must be a boolean when provided.`, label);
  }

  return value;
};
