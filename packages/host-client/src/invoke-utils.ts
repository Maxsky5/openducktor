import {
  isJsonObject,
  jsonValueSchema,
  type HostInvokeFailure,
  type JsonObject,
} from "@openducktor/contracts";
import type { HostCommandName } from "@openducktor/host";
import type { JsonValue } from "@openducktor/contracts";
import { z } from "zod";

export class HostInvokeError extends Error {
  override readonly cause: unknown;

  constructor(
    message: string,
    readonly failure: HostInvokeFailure | null = null,
    cause?: unknown,
  ) {
    super(message);
    this.name = "HostInvokeError";
    this.cause = cause;
  }
}

export type InvokeFn = (command: HostCommandName, args?: JsonObject) => Promise<JsonValue>;

export const toCommandArgs = (parsed: unknown): JsonObject => {
  const value = jsonValueSchema.safeParse(parsed);
  if (!value.success || !isJsonObject(value.data)) {
    throw new Error("Host command arguments must be a JSON object.");
  }
  return value.data;
};

export type OkResult = { ok: boolean };
export type UpdatedAtResult = { updatedAt: string };

const okResultSchema = z.object({ ok: z.boolean() });
const updatedAtResultSchema = z.object({
  updatedAt: z.string().refine((value) => value.trim().length > 0),
});

/**
 * Parse an array payload returned by a host command and validate each entry.
 */
export const parseArray = <T>(
  schema: { parse: (value: JsonValue) => T },
  payload: unknown,
  command: string,
): T[] => {
  if (!Array.isArray(payload)) {
    throw new Error(`Expected array payload from host command ${command}`);
  }
  return payload.map((entry) => schema.parse(entry));
};

/**
 * Parse the canonical `{ ok: boolean }` ack shape returned by host mutations.
 */
export const parseOkResult = (payload: unknown, command: string): OkResult => {
  const parsed = okResultSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Expected { ok: boolean } payload from host command ${command}`);
  }
  return parsed.data;
};

/**
 * Parse the canonical `{ updatedAt: string }` document-write result from the host.
 */
export const parseUpdatedAtResult = (payload: unknown, command: string): UpdatedAtResult => {
  const parsed = updatedAtResultSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Expected { updatedAt: string } payload from host command ${command}`);
  }
  return parsed.data;
};
