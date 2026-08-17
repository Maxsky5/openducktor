import type { HostInvokeFailure } from "@openducktor/contracts";
import type { HostCommandName } from "@openducktor/host";
import type { JsonValue } from "@openducktor/contracts";

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

export type InvokeFn = (
  command: HostCommandName,
  args?: Record<string, JsonValue>,
) => Promise<unknown>;

export const toCommandArgs = (parsed: unknown): Record<string, JsonValue> =>
  // SAFETY: command args cross the IPC transport boundary, which serializes payloads to
  // JSON-compatible values before they reach the host.
  parsed as Record<string, JsonValue>;

export type OkResult = { ok: boolean };
export type UpdatedAtResult = { updatedAt: string };

/**
 * Parse an array payload returned by a host command and validate each entry.
 */
export const parseArray = <T>(
  schema: { parse: (value: unknown) => T },
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
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as { ok?: unknown }).ok !== "boolean"
  ) {
    throw new Error(`Expected { ok: boolean } payload from host command ${command}`);
  }

  return {
    ok: (payload as { ok: boolean }).ok,
  };
};

/**
 * Parse the canonical `{ updatedAt: string }` document-write result from the host.
 */
export const parseUpdatedAtResult = (payload: unknown, command: string): UpdatedAtResult => {
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as { updatedAt?: unknown }).updatedAt !== "string" ||
    (payload as { updatedAt: string }).updatedAt.trim().length === 0
  ) {
    throw new Error(`Expected { updatedAt: string } payload from host command ${command}`);
  }

  return {
    updatedAt: (payload as { updatedAt: string }).updatedAt,
  };
};
