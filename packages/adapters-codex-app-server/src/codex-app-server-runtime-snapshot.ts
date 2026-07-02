import {
  type AgentPendingApprovalRequest,
  type AgentPendingQuestionRequest,
  type AgentSessionRuntimeSnapshot,
  classifyAgentSessionActivity,
  type ReadSessionRuntimeSnapshotInput,
  type SessionRef,
} from "@openducktor/core";
import type { CodexThreadInventory, CodexThreadSnapshot } from "./codex-app-server-threads";
import type { CodexSessionState } from "./types";

export type CodexRuntimeSnapshotSource =
  | { type: "local" }
  | { type: "thread"; thread: CodexThreadSnapshot }
  | { type: "missing" };

export type ResolveCodexRuntimeSnapshotSourceInput = {
  session: CodexSessionState;
  thread: CodexThreadSnapshot | null;
  threadIsLoaded: boolean;
  hasPendingInput: boolean;
  hasActiveTurn: boolean;
};

const resolveCodexRuntimeSnapshotSource = ({
  session,
  thread,
  threadIsLoaded,
  hasPendingInput,
  hasActiveTurn,
}: ResolveCodexRuntimeSnapshotSourceInput): CodexRuntimeSnapshotSource => {
  if (!thread || !threadIsLoaded) {
    return session.liveStatus || hasPendingInput || hasActiveTurn
      ? { type: "local" }
      : { type: "missing" };
  }

  if (thread.cwd !== session.workingDirectory) {
    return { type: "missing" };
  }

  if (hasPendingInput || hasActiveTurn) {
    return { type: "local" };
  }

  return { type: "thread", thread };
};

const toRuntimeSnapshot = (
  session: CodexSessionState,
  pendingApprovals: AgentPendingApprovalRequest[],
  pendingQuestions: AgentPendingQuestionRequest[],
  parentExternalSessionId?: string,
): AgentSessionRuntimeSnapshot => {
  const classification = classifyAgentSessionActivity({
    runtimeActivity: session.liveStatus?.classification ?? "idle",
    pendingApprovals,
    pendingQuestions,
  });
  return {
    availability: "runtime",
    classification,
    ref: {
      externalSessionId: session.threadId,
      repoPath: session.repoPath,
      runtimeKind: "codex",
      workingDirectory: session.workingDirectory,
    },
    ...(parentExternalSessionId ? { parentExternalSessionId } : {}),
    title: session.summary.title ?? (session.role ? `Codex ${session.role}` : "Codex"),
    startedAt: session.summary.startedAt,
    pendingApprovals,
    pendingQuestions,
  };
};

export const toRuntimeSnapshotFromThread = (
  thread: CodexThreadSnapshot,
  ref: { repoPath: string; externalSessionId?: string },
  pendingInput: {
    pendingApprovals?: AgentPendingApprovalRequest[];
    pendingQuestions?: AgentPendingQuestionRequest[];
  } = {},
): AgentSessionRuntimeSnapshot => {
  const parentExternalSessionId = thread.parentThreadId ?? thread.subAgentSource?.parentThreadId;
  const pendingApprovals = pendingInput.pendingApprovals ?? [];
  const pendingQuestions = pendingInput.pendingQuestions ?? [];
  return {
    availability: "runtime",
    classification: classifyAgentSessionActivity({
      runtimeActivity: thread.status.classification,
      pendingApprovals,
      pendingQuestions,
    }),
    ref: {
      externalSessionId: ref.externalSessionId ?? thread.id,
      repoPath: ref.repoPath,
      runtimeKind: "codex",
      workingDirectory: thread.cwd,
    },
    ...(parentExternalSessionId ? { parentExternalSessionId } : {}),
    title: thread.title,
    startedAt: thread.startedAt,
    pendingApprovals,
    pendingQuestions,
  };
};

const codexRuntimeSnapshotRef = (session: CodexSessionState): ReadSessionRuntimeSnapshotInput => ({
  externalSessionId: session.threadId,
  repoPath: session.repoPath,
  runtimeKind: "codex",
  workingDirectory: session.workingDirectory,
});

const parentExternalSessionIdFromThread = (
  session: CodexSessionState,
  thread: CodexThreadSnapshot | null,
): string | undefined => {
  if (!thread || thread.cwd !== session.workingDirectory) {
    return undefined;
  }
  return thread.parentThreadId ?? thread.subAgentSource?.parentThreadId ?? undefined;
};

export const toRefreshedRuntimeSnapshot = ({
  session,
  inventory,
  input,
  pendingApprovals,
  pendingQuestions,
  hasActiveTurn,
}: {
  session: CodexSessionState;
  inventory: CodexThreadInventory;
  input?: ReadSessionRuntimeSnapshotInput;
  pendingApprovals: AgentPendingApprovalRequest[];
  pendingQuestions: AgentPendingQuestionRequest[];
  hasActiveTurn: boolean;
}): AgentSessionRuntimeSnapshot => {
  const thread = inventory.threadsById.get(session.threadId) ?? null;
  const hasPendingInput = pendingApprovals.length > 0 || pendingQuestions.length > 0;
  const ref = input ?? codexRuntimeSnapshotRef(session);
  const runtimeSnapshotSource = resolveCodexRuntimeSnapshotSource({
    session,
    thread,
    threadIsLoaded: inventory.loadedIds.has(session.threadId),
    hasPendingInput,
    hasActiveTurn,
  });

  if (runtimeSnapshotSource.type === "local") {
    return toRuntimeSnapshot(
      session,
      pendingApprovals,
      pendingQuestions,
      parentExternalSessionIdFromThread(session, thread),
    );
  }
  if (runtimeSnapshotSource.type === "missing") {
    return missingRuntimeSnapshot(ref);
  }
  return toRuntimeSnapshotFromThread(runtimeSnapshotSource.thread, ref);
};

export const missingRuntimeSnapshot = (input: SessionRef): AgentSessionRuntimeSnapshot => ({
  availability: "missing",
  classification: "missing",
  ref: input,
  pendingApprovals: [],
  pendingQuestions: [],
});
