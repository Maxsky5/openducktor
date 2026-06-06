import type { AgentRole, AgentSessionSummary } from "@openducktor/core";
import { arrayFromUnknown, extractStringField, isPlainObject } from "./codex-app-server-shared";
import type {
  CodexThreadForkResult,
  CodexThreadResumeResult,
  CodexThreadStartResult,
} from "./types";

export type CodexThreadInventory = {
  runtimeId: string;
  loadedIds: Set<string>;
  threadsById: Map<string, CodexThreadSnapshot>;
};
export const extractThreadId = (
  response: CodexThreadStartResult | CodexThreadResumeResult | CodexThreadForkResult,
  action: string,
): { externalSessionId: string; startedAt?: string } => {
  const externalSessionId = response.thread?.id ?? response.thread?.threadId ?? response.threadId;
  if (!externalSessionId) {
    throw new Error(`Codex ${action} response is missing a thread identifier.`);
  }

  return response.startedAt
    ? { externalSessionId, startedAt: response.startedAt }
    : { externalSessionId };
};

export const toSessionSummary = (input: {
  externalSessionId: string;
  startedAt: string;
  title?: string;
  role: AgentRole | null;
  status: AgentSessionSummary["status"];
}): AgentSessionSummary => ({
  externalSessionId: input.externalSessionId,
  runtimeKind: "codex",
  ...(input.title ? { title: input.title } : {}),
  role: input.role,
  startedAt: input.startedAt,
  status: input.status,
});

export type CodexThreadStatusSnapshot = {
  classification: import("@openducktor/core").AgentSessionActivity;
  status: import("@openducktor/core").LiveAgentSessionStatus;
  agentSessionStatus: "running" | "idle";
};

export type CodexThreadSnapshot = {
  id: string;
  cwd: string;
  startedAt: string;
  title: string;
  status: CodexThreadStatusSnapshot;
};

const codexTimestampFromUnknownSeconds = (value: unknown): string =>
  typeof value === "number" ? new Date(value * 1000).toISOString() : new Date().toISOString();

export const codexThreadStatusSnapshot = (status: unknown): CodexThreadStatusSnapshot => {
  const type = isPlainObject(status)
    ? extractStringField(status, ["type"])
    : typeof status === "string"
      ? status
      : null;
  const normalized = type?.toLowerCase() ?? "idle";
  const activeFlags = isPlainObject(status)
    ? arrayFromUnknown(status.activeFlags ?? status.active_flags).filter(
        (flag): flag is string => typeof flag === "string",
      )
    : [];
  if (normalized === "active") {
    const flags = new Set(activeFlags.map((flag) => flag.toLowerCase()));
    if (flags.has("waitingonapproval") || flags.has("waiting_on_approval")) {
      return {
        classification: "waiting_for_permission",
        status: { type: "busy" },
        agentSessionStatus: "running",
      };
    }
    if (flags.has("waitingonuserinput") || flags.has("waiting_on_user_input")) {
      return {
        classification: "waiting_for_question",
        status: { type: "busy" },
        agentSessionStatus: "running",
      };
    }
    return { classification: "running", status: { type: "busy" }, agentSessionStatus: "running" };
  }
  return { classification: "idle", status: { type: "idle" }, agentSessionStatus: "idle" };
};

const codexThreadSnapshot = (thread: unknown): CodexThreadSnapshot | null => {
  if (!isPlainObject(thread)) {
    return null;
  }
  const id = extractStringField(thread, ["id", "threadId"]);
  const cwd = extractStringField(thread, ["cwd", "workingDirectory"]);
  if (!id || !cwd) {
    return null;
  }
  return {
    id,
    cwd,
    startedAt: codexTimestampFromUnknownSeconds(thread.createdAt ?? thread.created_at),
    title: extractStringField(thread, ["name", "preview"]) ?? `Codex ${id}`,
    status: codexThreadStatusSnapshot(thread.status),
  };
};

export const codexThreadList = (response: unknown): CodexThreadSnapshot[] =>
  isPlainObject(response)
    ? arrayFromUnknown(response.data)
        .map(codexThreadSnapshot)
        .filter((thread): thread is CodexThreadSnapshot => Boolean(thread))
    : [];

export const codexLoadedThreadIds = (response: unknown): Set<string> =>
  isPlainObject(response)
    ? new Set(
        arrayFromUnknown(response.data)
          .map((entry) => {
            if (typeof entry === "string") {
              return entry;
            }
            return isPlainObject(entry) ? extractStringField(entry, ["id", "threadId"]) : null;
          })
          .filter((id): id is string => Boolean(id)),
      )
    : new Set();

const threadSnapshotFromReadResponse = (response: unknown): CodexThreadSnapshot | null =>
  isPlainObject(response) ? codexThreadSnapshot(response.thread) : null;

export const requireThreadSnapshotFromReadResponse = (
  response: unknown,
  action: string,
  externalSessionId: string,
): CodexThreadSnapshot => {
  const threadSnapshot = threadSnapshotFromReadResponse(response);
  if (!threadSnapshot) {
    throw new Error(
      `Codex ${action} response for thread '${externalSessionId}' is missing thread status.`,
    );
  }
  return threadSnapshot;
};
