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
  workingDirectory: string;
  startedAt: string;
  title?: string;
  role: AgentRole | null;
  status: AgentSessionSummary["status"];
}): AgentSessionSummary => ({
  externalSessionId: input.externalSessionId,
  runtimeKind: "codex",
  workingDirectory: input.workingDirectory,
  ...(input.title ? { title: input.title } : {}),
  role: input.role,
  startedAt: input.startedAt,
  status: input.status,
});

export type CodexThreadStatusSnapshot = {
  classification: import("@openducktor/core").AgentSessionActivity;
};

export type CodexThreadSnapshot = {
  id: string;
  cwd: string;
  startedAt: string;
  updatedAtMs: number | null;
  title: string;
  status: CodexThreadStatusSnapshot;
  parentThreadId: string | null;
  agentNickname: string | null;
  agentRole: string | null;
  subAgentSource: CodexSubAgentSourceMetadata | null;
};

export type CodexSubAgentSourceMetadata = {
  parentThreadId: string;
  depth: number;
  agentPath: unknown;
  agentNickname: string | null;
  agentRole: string | null;
};

const codexTimestampFromUnknownSeconds = (value: unknown): string =>
  typeof value === "number" ? new Date(value * 1000).toISOString() : new Date().toISOString();

const codexTimestampMsFromUnknownSeconds = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value * 1000 : null;

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
      return { classification: "waiting_for_permission" };
    }
    if (flags.has("waitingonuserinput") || flags.has("waiting_on_user_input")) {
      return { classification: "waiting_for_question" };
    }
    return { classification: "running" };
  }
  return { classification: "idle" };
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
  const subAgentSource = codexSubAgentSourceMetadata(thread.source);
  return {
    id,
    cwd,
    startedAt: codexTimestampFromUnknownSeconds(thread.createdAt ?? thread.created_at),
    updatedAtMs: codexTimestampMsFromUnknownSeconds(thread.updatedAt ?? thread.updated_at),
    title: extractStringField(thread, ["name", "preview"]) ?? `Codex ${id}`,
    status: codexThreadStatusSnapshot(thread.status),
    parentThreadId:
      extractStringField(thread, ["parentThreadId", "parent_thread_id"]) ??
      subAgentSource?.parentThreadId ??
      null,
    agentNickname: extractStringField(thread, ["agentNickname", "agent_nickname"]),
    agentRole: extractStringField(thread, ["agentRole", "agent_role"]),
    subAgentSource,
  };
};

const codexSubAgentSourceMetadata = (source: unknown): CodexSubAgentSourceMetadata | null => {
  if (!isPlainObject(source)) {
    return null;
  }
  const subAgent = source.subAgent ?? source.sub_agent;
  if (!isPlainObject(subAgent)) {
    return null;
  }
  const threadSpawn = subAgent.thread_spawn ?? subAgent.threadSpawn;
  if (!isPlainObject(threadSpawn)) {
    return null;
  }
  const parentThreadId = extractStringField(threadSpawn, ["parent_thread_id", "parentThreadId"]);
  const depth = typeof threadSpawn.depth === "number" ? threadSpawn.depth : null;
  if (!parentThreadId || depth === null || !Number.isFinite(depth)) {
    return null;
  }
  return {
    parentThreadId,
    depth,
    agentPath: threadSpawn.agent_path ?? threadSpawn.agentPath ?? null,
    agentNickname: extractStringField(threadSpawn, ["agent_nickname", "agentNickname"]),
    agentRole: extractStringField(threadSpawn, ["agent_role", "agentRole"]),
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

export const threadSnapshotFromReadResponse = (response: unknown): CodexThreadSnapshot | null =>
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
