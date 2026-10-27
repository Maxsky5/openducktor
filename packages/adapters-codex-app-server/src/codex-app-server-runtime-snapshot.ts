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
  directoryMatch: boolean;
  hasPendingInput: boolean;
  hasActiveTurn: boolean;
};

const resolveCodexRuntimeSnapshotSource = ({
  session,
  thread,
  threadIsLoaded,
  directoryMatch,
  hasPendingInput,
  hasActiveTurn,
}: ResolveCodexRuntimeSnapshotSourceInput): CodexRuntimeSnapshotSource => {
  if (
    thread &&
    !threadIsLoaded &&
    directoryMatch &&
    thread.status.classification === "idle" &&
    (thread.parentThreadId ?? thread.subAgentSource?.parentThreadId) &&
    !hasPendingInput &&
    !hasActiveTurn
  ) {
    return { type: "thread", thread };
  }
  if (!thread || !threadIsLoaded) {
    return session.liveStatus || hasPendingInput || hasActiveTurn
      ? { type: "local" }
      : { type: "missing" };
  }

  if (!directoryMatch) {
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
  const sessionAssociation = session.summary.sessionAssociation;
  const classification = classifyAgentSessionActivity({
    runtimeActivity: session.liveStatus?.classification ?? "idle",
    pendingApprovals,
    pendingQuestions,
  });
  const snapshot: AgentSessionRuntimeSnapshot = {
    availability: "runtime",
    classification,
    ref: {
      externalSessionId: session.threadId,
      repoPath: session.repoPath,
      runtimeKind: "codex",
      workingDirectory: session.workingDirectory,
    },
    title:
      session.summary.title ??
      (sessionAssociation.kind === "workflow" ? `Codex ${sessionAssociation.role}` : "Codex"),
    startedAt: session.summary.startedAt,
    pendingApprovals,
    pendingQuestions,
  };
  if (parentExternalSessionId) {
    snapshot.parentExternalSessionId = parentExternalSessionId;
  }
  return snapshot;
};

export const toRuntimeSnapshotFromThread = (
  thread: CodexThreadSnapshot,
  ref: SessionRef,
  pendingInput: {
    pendingApprovals?: AgentPendingApprovalRequest[];
    pendingQuestions?: AgentPendingQuestionRequest[];
  } = {},
): AgentSessionRuntimeSnapshot => {
  const parentExternalSessionId = thread.parentThreadId ?? thread.subAgentSource?.parentThreadId;
  const pendingApprovals = pendingInput.pendingApprovals ?? [];
  const pendingQuestions = pendingInput.pendingQuestions ?? [];
  const snapshot: AgentSessionRuntimeSnapshot = {
    availability: "runtime",
    classification: classifyAgentSessionActivity({
      runtimeActivity: thread.status.classification,
      pendingApprovals,
      pendingQuestions,
    }),
    ref: {
      externalSessionId: ref.externalSessionId,
      repoPath: ref.repoPath,
      runtimeKind: "codex",
      workingDirectory: ref.workingDirectory,
    },
    title: thread.title,
    startedAt: thread.startedAt,
    pendingApprovals,
    pendingQuestions,
  };
  if (parentExternalSessionId) {
    snapshot.parentExternalSessionId = parentExternalSessionId;
  }
  return snapshot;
};

const codexRuntimeSnapshotRef = (session: CodexSessionState): ReadSessionRuntimeSnapshotInput => ({
  externalSessionId: session.threadId,
  repoPath: session.repoPath,
  runtimeKind: "codex",
  workingDirectory: session.workingDirectory,
});

const parentExternalSessionIdFromThread = (
  thread: CodexThreadSnapshot | null,
  directoryMatch: boolean,
): string | undefined => {
  if (!thread || !directoryMatch) {
    return undefined;
  }
  return thread.parentThreadId ?? thread.subAgentSource?.parentThreadId ?? undefined;
};

export const toRefreshedRuntimeSnapshot = ({
  session,
  inventory,
  directoryMatch,
  input,
  pendingApprovals,
  pendingQuestions,
  hasActiveTurn,
}: {
  session: CodexSessionState;
  inventory: CodexThreadInventory;
  directoryMatch: boolean;
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
    directoryMatch,
    hasPendingInput,
    hasActiveTurn,
  });

  if (runtimeSnapshotSource.type === "local") {
    return toRuntimeSnapshot(
      session,
      pendingApprovals,
      pendingQuestions,
      parentExternalSessionIdFromThread(thread, directoryMatch),
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
