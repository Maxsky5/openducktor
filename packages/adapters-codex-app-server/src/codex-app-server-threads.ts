import type { AgentSessionAssociation, AgentSessionSummary } from "@openducktor/core";
import type {
  CodexAppServerSessionSource,
  CodexAppServerThread,
  CodexAppServerThreadLoadedListResponse,
  CodexAppServerThreadListResponse,
  CodexAppServerThreadReadResponse,
  CodexAppServerThreadStatus,
} from "@openducktor/contracts";
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
) => ({
  externalSessionId: response.thread.id,
  startedAt: codexTimestampFromSeconds(response.thread.createdAt),
});

export const toSessionSummary = (input: {
  externalSessionId: string;
  workingDirectory: string;
  startedAt: string;
  title?: string;
  sessionAssociation: AgentSessionAssociation;
  status: AgentSessionSummary["status"];
}): AgentSessionSummary => ({
  externalSessionId: input.externalSessionId,
  runtimeKind: "codex",
  workingDirectory: input.workingDirectory,
  ...(input.title ? { title: input.title } : undefined),
  sessionAssociation: input.sessionAssociation,
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
  agentPath: string | null;
  agentNickname: string | null;
  agentRole: string | null;
};

const codexTimestampFromSeconds = (value: number): string => new Date(value * 1000).toISOString();

const codexTimestampMsFromSeconds = (value: number | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isFinite(value)) {
    throw new Error("Codex thread updatedAt must be a finite number.");
  }
  const timestampMs = value * 1000;
  if (!Number.isFinite(timestampMs)) {
    throw new Error("Codex thread updatedAt exceeds the supported timestamp range.");
  }
  return timestampMs;
};

export const codexThreadStatusSnapshot = (
  status: CodexAppServerThreadStatus | CodexAppServerThreadStatus["type"] | undefined,
): CodexThreadStatusSnapshot => {
  if (status === undefined || status === "idle" || status === "notLoaded") {
    return { classification: "idle" };
  }
  if (status === "active") return { classification: "running" };
  if (status === "systemError") {
    throw new Error("Codex thread reported a system error.");
  }
  if (status.type === "idle" || status.type === "notLoaded") {
    return { classification: "idle" };
  }
  if (status.type === "systemError") {
    throw new Error("Codex thread reported a system error.");
  }
  if (status.activeFlags.includes("waitingOnApproval")) {
    return { classification: "waiting_for_permission" };
  }
  if (status.activeFlags.includes("waitingOnUserInput")) {
    return { classification: "waiting_for_question" };
  }
  return { classification: "running" };
};

const codexThreadSnapshot = (thread: CodexAppServerThread): CodexThreadSnapshot => {
  const subAgentSource = codexSubAgentSourceMetadata(thread.source);
  const title = thread.name?.trim() || thread.preview.trim() || `Codex ${thread.id}`;
  return {
    id: thread.id,
    cwd: thread.cwd,
    startedAt: codexTimestampFromSeconds(thread.createdAt),
    updatedAtMs: codexTimestampMsFromSeconds(thread.updatedAt),
    title,
    status: codexThreadStatusSnapshot(thread.status),
    parentThreadId: thread.parentThreadId ?? subAgentSource?.parentThreadId ?? null,
    agentNickname: thread.agentNickname,
    agentRole: thread.agentRole,
    subAgentSource,
  };
};

const codexSubAgentSourceMetadata = (
  source: CodexAppServerSessionSource | null | undefined,
): CodexSubAgentSourceMetadata | null => {
  if (!source || typeof source === "string" || !("subAgent" in source)) {
    return null;
  }
  const subAgent = source.subAgent;
  if (typeof subAgent === "string" || "other" in subAgent) {
    return null;
  }
  if (!("thread_spawn" in subAgent)) {
    return null;
  }
  const threadSpawn = subAgent.thread_spawn;
  if (!threadSpawn.parent_thread_id || !Number.isFinite(threadSpawn.depth)) {
    return null;
  }
  return {
    parentThreadId: threadSpawn.parent_thread_id,
    depth: threadSpawn.depth,
    agentPath: threadSpawn.agent_path,
    agentNickname: threadSpawn.agent_nickname,
    agentRole: threadSpawn.agent_role,
  };
};

export const codexThreadList = (
  response: CodexAppServerThreadListResponse,
): CodexThreadSnapshot[] => response.data.map(codexThreadSnapshot);

export const codexLoadedThreadIds = (
  response: CodexAppServerThreadLoadedListResponse,
): Set<string> => new Set(response.data);

export const threadSnapshotFromReadResponse = (
  response: CodexAppServerThreadReadResponse | undefined,
): CodexThreadSnapshot | null => (response ? codexThreadSnapshot(response.thread) : null);

export const requireThreadSnapshotFromReadResponse = (
  response: CodexAppServerThreadReadResponse | undefined,
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
