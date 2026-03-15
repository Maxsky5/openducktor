export type InvokeFn = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

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
