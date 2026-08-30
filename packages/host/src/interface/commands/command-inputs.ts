import {
  type HostCommandArgs as ContractHostCommandArgs,
  type HostCommandInputRecord,
  hostCommandInputRecordSchema,
} from "@openducktor/contracts";
import { z } from "zod";
import { HostValidationError } from "../../effect/host-errors";

const invalidInput = (message: string, field?: string): HostValidationError =>
  new HostValidationError({
    message,
    field,
  });

export const commandInputRecordSchema = hostCommandInputRecordSchema;
export const commandInputStringSchema = z.string();
export const commandInputOptionalStringSchema = z.union([z.string(), z.null(), z.undefined()]);
export const commandInputOptionalBooleanSchema = z.union([z.boolean(), z.null(), z.undefined()]);
export type CommandInputRecord = HostCommandInputRecord;
export type HostCommandArgs = ContractHostCommandArgs;

export const requireRecord = (
  result: z.ZodSafeParseResult<CommandInputRecord>,
  label: string,
): CommandInputRecord => {
  if (!result.success) {
    throw invalidInput(`${label} must be an object.`, label);
  }

  return result.data;
};

export const requireParsedRecord = (
  result: z.ZodSafeParseResult<CommandInputRecord>,
  label: string,
): CommandInputRecord => {
  if (!result.success) {
    throw invalidInput(`${label} must be an object.`, label);
  }

  return result.data;
};

export const requireString = (result: z.ZodSafeParseResult<string>, label: string): string => {
  if (!result.success || result.data.trim().length === 0) {
    throw invalidInput(`${label} is required.`, label);
  }

  return result.data.trim();
};

export const requireStringPreservingWhitespace = (
  result: z.ZodSafeParseResult<string>,
  label: string,
): string => {
  if (!result.success || result.data.trim().length === 0) {
    throw invalidInput(`${label} is required.`, label);
  }

  return result.data;
};

export const optionalString = (
  result: z.ZodSafeParseResult<string | null | undefined>,
  label: string,
): string | undefined => {
  if (!result.success) {
    throw invalidInput(`${label} must be a string when provided.`, label);
  }
  if (result.data === undefined || result.data === null) return undefined;

  const trimmed = result.data.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const optionalBoolean = (
  result: z.ZodSafeParseResult<boolean | null | undefined>,
  label: string,
): boolean | undefined => {
  if (!result.success) {
    throw invalidInput(`${label} must be a boolean when provided.`, label);
  }

  return result.data ?? undefined;
};
