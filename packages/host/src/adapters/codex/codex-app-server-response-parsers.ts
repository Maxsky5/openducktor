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

export const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, context: string): Record<string, unknown> => {
  if (!isJsonRecord(value)) {
    throw new HostValidationError({
      message: `${context} must be an object`,
      details: { context },
    });
  }
  return value;
};

const requireString = (value: unknown, context: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HostValidationError({
      message: `${context} must be a non-empty string`,
      details: { context },
    });
  }
  return value;
};

const parseCursor = (value: unknown, context: string): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return requireString(value, context);
};

const parseThreadStatus = (value: unknown, context: string): CodexSessionStatus => {
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
  value: unknown,
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

export const parseThreadListResponse = (value: unknown): CodexAppServerThreadListResponse => {
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

export const parseThreadReadResponse = (value: unknown): CodexAppServerThread => {
  const payload = requireRecord(value, "Codex thread/read response");
  const thread = requireRecord(payload.thread, "Codex thread/read response thread");
  requireString(thread.id, "Codex thread/read response thread id");
  requireString(thread.cwd, "Codex thread/read response thread cwd");
  parseThreadStatus(thread.status, "Codex thread/read response thread");
  return thread as unknown as CodexAppServerThread;
};

export const parseThreadTurnsListResponse = (
  value: unknown,
): CodexAppServerThreadTurnsListResponse => {
  const payload = requireRecord(value, "Codex thread/turns/list response");
  if (!Array.isArray(payload.data)) {
    throw new HostValidationError({
      message: "Codex thread/turns/list response data must be an array",
      details: { context: "Codex thread/turns/list response" },
    });
  }
  return payload as unknown as CodexAppServerThreadTurnsListResponse;
};
