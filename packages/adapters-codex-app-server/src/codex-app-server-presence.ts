import type {
  AgentPendingApprovalRequest,
  AgentPendingQuestionRequest,
  AgentSessionPresenceSnapshot,
  AgentSessionRef,
  ReadSessionPresenceInput,
} from "@openducktor/core";
import type {
  PendingApprovalEntry,
  PendingQuestionEntry,
} from "./codex-app-server-server-requests";
import type { CodexThreadInventory, CodexThreadSnapshot } from "./codex-app-server-threads";
import type { CodexSessionState } from "./types";

export type CodexPresenceSource =
  | { type: "local" }
  | { type: "thread"; thread: CodexThreadSnapshot }
  | { type: "stale" };

export type ResolveCodexPresenceSourceInput = {
  session: CodexSessionState;
  thread: CodexThreadSnapshot | null;
  threadIsLoaded: boolean;
  hasPendingInput: boolean;
  hasActiveTurn: boolean;
};

export type CodexPendingInputStore = {
  pendingApprovalIdsBySessionId: Map<string, Set<string>>;
  pendingApprovalsByRequestId: Map<string, PendingApprovalEntry>;
  pendingQuestionIdsBySessionId: Map<string, Set<string>>;
  pendingQuestionsByRequestId: Map<string, PendingQuestionEntry>;
};

export const resolveCodexPresenceSource = ({
  session,
  thread,
  threadIsLoaded,
  hasPendingInput,
  hasActiveTurn,
}: ResolveCodexPresenceSourceInput): CodexPresenceSource => {
  if (!thread || !threadIsLoaded) {
    return session.liveStatus || hasPendingInput || hasActiveTurn
      ? { type: "local" }
      : { type: "stale" };
  }

  if (thread.cwd !== session.workingDirectory) {
    return { type: "stale" };
  }

  if (
    hasPendingInput ||
    hasActiveTurn ||
    (session.liveStatus?.agentSessionStatus === "idle" &&
      thread.status.agentSessionStatus === "running")
  ) {
    return { type: "local" };
  }

  return { type: "thread", thread };
};

export const toPresenceSnapshot = (
  session: CodexSessionState,
  pendingApprovals: AgentPendingApprovalRequest[],
  pendingQuestions: AgentPendingQuestionRequest[],
): AgentSessionPresenceSnapshot => {
  const hasPendingInput = pendingApprovals.length > 0 || pendingQuestions.length > 0;
  const liveStatus = session.liveStatus;
  const agentSessionStatus = liveStatus?.agentSessionStatus ?? "idle";
  const status =
    liveStatus?.status ?? (agentSessionStatus === "running" ? { type: "busy" } : { type: "idle" });
  const classification =
    pendingQuestions.length > 0
      ? "waiting_for_question"
      : pendingApprovals.length > 0
        ? "waiting_for_permission"
        : (liveStatus?.classification ?? "idle");
  return {
    presence: "runtime",
    classification,
    ref: {
      externalSessionId: session.threadId,
      repoPath: session.repoPath,
      runtimeKind: "codex",
      workingDirectory: session.workingDirectory,
    },
    title: session.summary.title ?? (session.role ? `Codex ${session.role}` : "Codex"),
    startedAt: session.summary.startedAt,
    status: hasPendingInput ? { type: "busy" } : status,
    agentSessionStatus: hasPendingInput ? "running" : agentSessionStatus,
    pendingApprovals,
    pendingQuestions,
  };
};

export const toPresenceSnapshotFromThread = (
  thread: CodexThreadSnapshot,
  ref: { repoPath: string; externalSessionId?: string },
): AgentSessionPresenceSnapshot => ({
  presence: "runtime",
  classification: thread.status.classification,
  ref: {
    externalSessionId: ref.externalSessionId ?? thread.id,
    repoPath: ref.repoPath,
    runtimeKind: "codex",
    workingDirectory: thread.cwd,
  },
  title: thread.title,
  startedAt: thread.startedAt,
  status: thread.status.status,
  agentSessionStatus: thread.status.agentSessionStatus,
  pendingApprovals: [],
  pendingQuestions: [],
});

export const pendingApprovalsForCodexSession = (
  store: CodexPendingInputStore,
  externalSessionId: string,
): AgentPendingApprovalRequest[] => {
  const requestIds = store.pendingApprovalIdsBySessionId.get(externalSessionId);
  if (!requestIds) {
    return [];
  }
  return [...requestIds]
    .map((requestId) => store.pendingApprovalsByRequestId.get(requestId)?.request)
    .filter((request): request is AgentPendingApprovalRequest => Boolean(request));
};

export const pendingQuestionsForCodexSession = (
  store: CodexPendingInputStore,
  externalSessionId: string,
): AgentPendingQuestionRequest[] => {
  const requestIds = store.pendingQuestionIdsBySessionId.get(externalSessionId);
  if (!requestIds) {
    return [];
  }
  return [...requestIds]
    .map((requestId) => store.pendingQuestionsByRequestId.get(requestId)?.request)
    .filter((request): request is AgentPendingQuestionRequest => Boolean(request));
};

export const codexSessionRef = (session: CodexSessionState): ReadSessionPresenceInput => ({
  externalSessionId: session.threadId,
  repoPath: session.repoPath,
  runtimeKind: "codex",
  workingDirectory: session.workingDirectory,
});

export const toRefreshedPresenceSnapshot = ({
  session,
  inventory,
  input,
  pendingApprovals,
  pendingQuestions,
  hasActiveTurn,
}: {
  session: CodexSessionState;
  inventory: CodexThreadInventory;
  input?: ReadSessionPresenceInput;
  pendingApprovals: AgentPendingApprovalRequest[];
  pendingQuestions: AgentPendingQuestionRequest[];
  hasActiveTurn: boolean;
}): AgentSessionPresenceSnapshot => {
  const thread = inventory.threadsById.get(session.threadId) ?? null;
  const hasPendingInput = pendingApprovals.length > 0 || pendingQuestions.length > 0;
  const ref = input ?? codexSessionRef(session);
  const presenceSource = resolveCodexPresenceSource({
    session,
    thread,
    threadIsLoaded: inventory.loadedIds.has(session.threadId),
    hasPendingInput,
    hasActiveTurn,
  });

  if (presenceSource.type === "local") {
    return toPresenceSnapshot(session, pendingApprovals, pendingQuestions);
  }
  if (presenceSource.type === "stale") {
    return stalePresence(ref);
  }
  return toPresenceSnapshotFromThread(presenceSource.thread, ref);
};

export const stalePresence = (input: AgentSessionRef): AgentSessionPresenceSnapshot => ({
  presence: "stale",
  classification: "stale",
  ref: input,
  pendingApprovals: [],
  pendingQuestions: [],
});
