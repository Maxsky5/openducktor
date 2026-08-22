import type {
  CodexAppServerThread,
  CodexAppServerThreadTurnsListResponse,
} from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";
import type {
  CodexAppServerLoadedThreadListResponse,
  CodexAppServerThreadListResponse,
  CodexSessionStatus,
} from "../../ports/codex-app-server-port";
import { jsonValueSchema, type JsonValue, hasRuntimeType } from "@openducktor/contracts";

type JsonBoundaryInput = Parameters<typeof jsonValueSchema.safeParse>[0];

export const isJsonRecord = (value: JsonBoundaryInput): value is Record<string, JsonValue> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  jsonValueSchema.safeParse(value).success;

const requireRecord = (value: JsonBoundaryInput, context: string): Record<string, JsonValue> => {
  if (!isJsonRecord(value)) {
    throw new HostValidationError({
      message: `${context} must be an object`,
      details: { context },
    });
  }
  return value;
};

const requireString = (value: JsonBoundaryInput, context: string): string => {
  if (!hasRuntimeType(value, "string") || value.trim().length === 0) {
    throw new HostValidationError({
      message: `${context} must be a non-empty string`,
      details: { context },
    });
  }
  return value;
};

const parseCursor = (value: JsonBoundaryInput, context: string): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return requireString(value, context);
};

const parseThreadStatus = (value: JsonBoundaryInput, context: string): CodexSessionStatus => {
  const record = requireRecord(value ?? null, `${context} status`);
  if (record.type === "idle" || record.type === "notLoaded" || record.type === "systemError") {
    return record.type;
  }
  if (record.type === "active") {
    if (!Array.isArray(record.activeFlags)) {
      throw new HostValidationError({
        message: `${context} active status activeFlags must be an array`,
        details: { context },
      });
    }
    return record.type;
  }
  throw new HostValidationError({
    message: `${context} has unsupported Codex thread status: ${String(record.type)}`,
    details: { context, statusType: record.type },
  });
};

export const parseLoadedThreadListResponse = (
  value: JsonBoundaryInput,
): CodexAppServerLoadedThreadListResponse => {
  const payload = requireRecord(value, "Codex thread/loaded/list response");
  if (!Array.isArray(payload.data)) {
    throw new HostValidationError({
      message: "Codex thread/loaded/list response data must be an array",
      details: { context: "Codex thread/loaded/list response" },
    });
  }
  return {
    data: payload.data.map((entry, index) => {
      return requireString(entry, `Codex loaded thread entry ${index}`);
    }),
    nextCursor: parseCursor(payload.nextCursor, "Codex thread/loaded/list nextCursor"),
  };
};

export const parseThreadListResponse = (
  value: JsonBoundaryInput,
): CodexAppServerThreadListResponse => {
  const payload = requireRecord(value, "Codex thread/list response");
  if (!Array.isArray(payload.data)) {
    throw new HostValidationError({
      message: "Codex thread/list response data must be an array",
      details: { context: "Codex thread/list response" },
    });
  }
  return {
    data: payload.data.map((entry, index) => {
      const record = requireRecord(entry, `Codex thread entry ${index}`);
      return {
        id: requireString(record.id, `Codex thread entry ${index} id`),
        cwd: requireString(record.cwd, `Codex thread entry ${index} cwd`),
        status: parseThreadStatus(record.status, `Codex thread entry ${index}`),
      };
    }),
    nextCursor: parseCursor(payload.nextCursor, "Codex thread/list nextCursor"),
    backwardsCursor: parseCursor(payload.backwardsCursor, "Codex thread/list backwardsCursor"),
  };
};

export const parseThreadReadResponse = (value: JsonBoundaryInput): CodexAppServerThread => {
  const payload = requireRecord(value, "Codex thread/read response");
  const thread = requireRecord(payload.thread, "Codex thread/read response thread");
  requireString(thread.id, "Codex thread/read response thread id");
  requireString(thread.cwd, "Codex thread/read response thread cwd");
  parseThreadStatus(thread.status, "Codex thread/read response thread");
  // SAFETY: The runtime adapter builds this value from the contract fields required by `CodexAppServerThread`.
  return thread as CodexAppServerThread;
};

export const parseThreadTurnsListResponse = (
  value: JsonBoundaryInput,
): CodexAppServerThreadTurnsListResponse => {
  const payload = requireRecord(value, "Codex thread/turns/list response");
  if (!Array.isArray(payload.data)) {
    throw new HostValidationError({
      message: "Codex thread/turns/list response data must be an array",
      details: { context: "Codex thread/turns/list response" },
    });
  }
  for (const [index, entry] of payload.data.entries()) {
    const turn = requireRecord(entry, `Codex thread/turns/list response data[${index}]`);
    const itemsContext = `Codex thread/turns/list response data[${index}].items`;
    if (!Array.isArray(turn.items)) {
      throw new HostValidationError({
        message: `${itemsContext} must be an array`,
        details: { context: itemsContext },
      });
    }
    for (const [itemIndex, item] of turn.items.entries()) {
      requireRecord(item, `${itemsContext}[${itemIndex}]`);
    }
  }
  // SAFETY: The preceding runtime guard establishes `CodexAppServerThreadTurnsListResponse` before this assertion.
  return {
    data: payload.data,
    nextCursor: parseCursor(payload.nextCursor, "Codex thread/turns/list nextCursor"),
    backwardsCursor: parseCursor(
      payload.backwardsCursor,
      "Codex thread/turns/list backwardsCursor",
    ),
  } as CodexAppServerThreadTurnsListResponse;
};
