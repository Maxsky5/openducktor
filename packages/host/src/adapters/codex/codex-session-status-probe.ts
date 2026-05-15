import type { RuntimeRoute } from "@openducktor/contracts";
import type { CodexAppServerPort } from "../../ports/codex-app-server-port";

type CodexSessionStatus = "active" | "idle" | "notLoaded" | "systemError";

type CodexLoadedThreadListResponse = {
  data: string[];
  nextCursor: string | null;
};

type CodexThreadEntry = {
  id: string;
  cwd: string;
  status: CodexSessionStatus;
};

type CodexThreadListResponse = {
  data: CodexThreadEntry[];
  nextCursor: string | null;
  backwardsCursor: string | null;
};

export type CodexSessionStatusProbeInput = {
  codexAppServer: Pick<CodexAppServerPort, "request">;
  runtimeRoute: RuntimeRoute;
  externalSessionId: string;
  workingDirectory: string;
};

const requireRecord = (value: unknown, context: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
};

const requireString = (value: unknown, context: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
};

const parseCursor = (value: unknown, context: string): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return requireString(value, context);
};

const parseLoadedThreadListResponse = (value: unknown): CodexLoadedThreadListResponse => {
  const payload = requireRecord(value, "Codex thread/loaded/list response");
  if (!Array.isArray(payload.data)) {
    throw new Error("Codex thread/loaded/list response data must be an array");
  }

  return {
    data: payload.data.map((entry, index) => {
      return requireString(entry, `Codex loaded thread entry ${index}`);
    }),
    nextCursor: parseCursor(payload.nextCursor, "Codex thread/loaded/list nextCursor"),
  };
};

const parseThreadStatus = (value: unknown, context: string): CodexSessionStatus => {
  const record = requireRecord(value, `${context} status`);
  if (record.type === "idle" || record.type === "notLoaded" || record.type === "systemError") {
    return record.type;
  }
  if (record.type === "active") {
    if (!Array.isArray(record.activeFlags)) {
      throw new Error(`${context} active status activeFlags must be an array`);
    }
    return record.type;
  }
  throw new Error(`${context} has unsupported Codex thread status: ${String(record.type)}`);
};

const parseThreadListResponse = (value: unknown): CodexThreadListResponse => {
  const payload = requireRecord(value, "Codex thread/list response");
  if (!Array.isArray(payload.data)) {
    throw new Error("Codex thread/list response data must be an array");
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

const runtimeIdFromRoute = (runtimeRoute: RuntimeRoute): string | null =>
  runtimeRoute.type === "stdio" ? runtimeRoute.identity : null;

const loadLoadedThreadIds = async (
  codexAppServer: Pick<CodexAppServerPort, "request">,
  runtimeId: string,
): Promise<Set<string>> => {
  const loadedThreadIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  while (true) {
    if (cursor !== null) {
      if (seenCursors.has(cursor)) {
        throw new Error("Codex thread/loaded/list returned a repeated pagination cursor");
      }
      seenCursors.add(cursor);
    }

    const response = parseLoadedThreadListResponse(
      await codexAppServer.request({
        runtimeId,
        method: "thread/loaded/list",
        params: { cursor, limit: 100 },
      }),
    );
    for (const threadId of response.data) {
      loadedThreadIds.add(threadId);
    }

    cursor = response.nextCursor;
    if (cursor === null) {
      return loadedThreadIds;
    }
  }
};

const hasBusyLoadedThread = async (
  input: CodexSessionStatusProbeInput,
  runtimeId: string,
  loadedThreadIds: Set<string>,
): Promise<boolean> => {
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  while (true) {
    if (cursor !== null) {
      if (seenCursors.has(cursor)) {
        throw new Error("Codex thread/list returned a repeated pagination cursor");
      }
      seenCursors.add(cursor);
    }

    const response = parseThreadListResponse(
      await input.codexAppServer.request({
        runtimeId,
        method: "thread/list",
        params: { cursor, limit: 100 },
      }),
    );

    for (const thread of response.data) {
      if (thread.id !== input.externalSessionId) {
        continue;
      }
      if (!loadedThreadIds.has(thread.id)) {
        continue;
      }
      if (thread.cwd !== input.workingDirectory) {
        continue;
      }
      return thread.status === "active";
    }

    cursor = response.nextCursor;
    if (cursor === null) {
      return false;
    }
  }
};

export const probeCodexSessionStatus = async (
  input: CodexSessionStatusProbeInput,
): Promise<{ supported: boolean; hasLiveSession: boolean }> => {
  const runtimeId = runtimeIdFromRoute(input.runtimeRoute);
  if (runtimeId === null) {
    return { supported: false, hasLiveSession: false };
  }

  const loadedThreadIds = await loadLoadedThreadIds(input.codexAppServer, runtimeId);
  if (loadedThreadIds.size === 0) {
    return { supported: true, hasLiveSession: false };
  }

  return {
    supported: true,
    hasLiveSession: await hasBusyLoadedThread(input, runtimeId, loadedThreadIds),
  };
};
