import type {
  AgentPendingApprovalRequest,
  AgentPendingQuestionRequest,
  AgentSessionPresenceSnapshot,
  AgentSessionRef,
} from "@openducktor/core";
import type { CodexThreadSnapshot } from "./codex-app-server-threads";
import type { CodexSessionState } from "./types";

export const toPresenceSnapshot = (
  session: CodexSessionState,
  pendingApprovals: AgentPendingApprovalRequest[],
  pendingQuestions: AgentPendingQuestionRequest[],
): AgentSessionPresenceSnapshot => {
  const hasPendingInput = pendingApprovals.length > 0 || pendingQuestions.length > 0;
  const liveStatus = session.liveStatus;
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
    runtimeId: session.runtimeId,
    title: `Codex ${session.role}`,
    startedAt: session.summary.startedAt,
    status: hasPendingInput ? { type: "busy" } : (liveStatus?.status ?? { type: "idle" }),
    agentSessionStatus: hasPendingInput ? "running" : (liveStatus?.agentSessionStatus ?? "idle"),
    pendingApprovals,
    pendingQuestions,
  };
};

export const toPresenceSnapshotFromThread = (
  thread: CodexThreadSnapshot,
  ref: { repoPath: string; externalSessionId?: string },
  runtimeId: string,
): AgentSessionPresenceSnapshot => ({
  presence: "runtime",
  classification: thread.status.classification,
  ref: {
    externalSessionId: ref.externalSessionId ?? thread.id,
    repoPath: ref.repoPath,
    runtimeKind: "codex",
    workingDirectory: thread.cwd,
  },
  runtimeId,
  title: thread.title,
  startedAt: thread.startedAt,
  status: thread.status.status,
  agentSessionStatus: thread.status.agentSessionStatus,
  pendingApprovals: [],
  pendingQuestions: [],
});

export const stalePresence = (
  input: AgentSessionRef,
  runtimeId: string | null = null,
): AgentSessionPresenceSnapshot => ({
  presence: "stale",
  classification: "stale",
  ref: input,
  runtimeId,
  pendingApprovals: [],
  pendingQuestions: [],
});
