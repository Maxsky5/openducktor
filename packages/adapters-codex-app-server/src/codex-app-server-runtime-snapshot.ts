import type {
  AgentPendingApprovalRequest,
  AgentPendingQuestionRequest,
  AgentSessionRef,
  AgentSessionRuntimeSnapshot,
  ReadSessionRuntimeSnapshotInput,
} from "@openducktor/core";
import { agentSessionStatusFromActivity } from "@openducktor/core";
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

export const resolveCodexRuntimeSnapshotSource = ({
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

  if (
    hasPendingInput ||
    hasActiveTurn ||
    (session.liveStatus &&
      agentSessionStatusFromActivity(session.liveStatus.classification) === "idle" &&
      agentSessionStatusFromActivity(thread.status.classification) === "running")
  ) {
    return { type: "local" };
  }

  return { type: "thread", thread };
};

export const toRuntimeSnapshot = (
  session: CodexSessionState,
  pendingApprovals: AgentPendingApprovalRequest[],
  pendingQuestions: AgentPendingQuestionRequest[],
): AgentSessionRuntimeSnapshot => {
  const liveStatus = session.liveStatus;
  const classification =
    pendingQuestions.length > 0
      ? "waiting_for_question"
      : pendingApprovals.length > 0
        ? "waiting_for_permission"
        : (liveStatus?.classification ?? "idle");
  return {
    availability: "runtime",
    classification,
    ref: {
      externalSessionId: session.threadId,
      repoPath: session.repoPath,
      runtimeKind: "codex",
      workingDirectory: session.workingDirectory,
    },
    title: session.summary.title ?? (session.role ? `Codex ${session.role}` : "Codex"),
    startedAt: session.summary.startedAt,
    pendingApprovals,
    pendingQuestions,
  };
};

export const toRuntimeSnapshotFromThread = (
  thread: CodexThreadSnapshot,
  ref: { repoPath: string; externalSessionId?: string },
): AgentSessionRuntimeSnapshot => ({
  availability: "runtime",
  classification: thread.status.classification,
  ref: {
    externalSessionId: ref.externalSessionId ?? thread.id,
    repoPath: ref.repoPath,
    runtimeKind: "codex",
    workingDirectory: thread.cwd,
  },
  title: thread.title,
  startedAt: thread.startedAt,
  pendingApprovals: [],
  pendingQuestions: [],
});

export const codexSessionRef = (session: CodexSessionState): ReadSessionRuntimeSnapshotInput => ({
  externalSessionId: session.threadId,
  repoPath: session.repoPath,
  runtimeKind: "codex",
  workingDirectory: session.workingDirectory,
});

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
  const ref = input ?? codexSessionRef(session);
  const runtimeSnapshotSource = resolveCodexRuntimeSnapshotSource({
    session,
    thread,
    threadIsLoaded: inventory.loadedIds.has(session.threadId),
    hasPendingInput,
    hasActiveTurn,
  });

  if (runtimeSnapshotSource.type === "local") {
    return toRuntimeSnapshot(session, pendingApprovals, pendingQuestions);
  }
  if (runtimeSnapshotSource.type === "missing") {
    return missingRuntimeSnapshot(ref);
  }
  return toRuntimeSnapshotFromThread(runtimeSnapshotSource.thread, ref);
};

export const missingRuntimeSnapshot = (input: AgentSessionRef): AgentSessionRuntimeSnapshot => ({
  availability: "missing",
  classification: "missing",
  ref: input,
  pendingApprovals: [],
  pendingQuestions: [],
});
