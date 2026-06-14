import type { AgentSessionPresenceSnapshot } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export type { AgentSessionPresence, AgentSessionPresenceSnapshot } from "@openducktor/core";

const clearLiveTurnFields = (): Pick<
  AgentSessionState,
  | "pendingUserMessageStartedAt"
  | "draftAssistantText"
  | "draftAssistantMessageId"
  | "draftReasoningText"
  | "draftReasoningMessageId"
> => ({
  pendingUserMessageStartedAt: undefined,
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
});

const statusFromRuntimePresence = (
  current: AgentSessionState,
  snapshot: Extract<AgentSessionPresenceSnapshot, { presence: "runtime" }>,
): AgentSessionState["status"] => {
  if (current.status === "starting" && !sessionPresenceHasPendingInput(snapshot)) {
    return "starting";
  }
  return snapshot.agentSessionStatus;
};

const statusWithoutRuntimePresence = (current: AgentSessionState): AgentSessionState["status"] => {
  if (current.status === "error" || current.status === "stopped" || current.status === "starting") {
    return current.status;
  }
  return "idle";
};

export const shouldObserveAgentSessionPresenceSnapshot = (
  snapshot: AgentSessionPresenceSnapshot,
): boolean => {
  return snapshot.presence === "runtime" && snapshot.classification !== "idle";
};

export const sessionPresenceHasPendingInput = (snapshot: AgentSessionPresenceSnapshot): boolean => {
  return snapshot.pendingApprovals.length > 0 || snapshot.pendingQuestions.length > 0;
};

export const applyAgentSessionPresenceSnapshotToSession = (
  current: AgentSessionState,
  snapshot: AgentSessionPresenceSnapshot,
): AgentSessionState => {
  if (snapshot.presence === "runtime") {
    const status = statusFromRuntimePresence(current, snapshot);
    const liveTurnFields = status === "idle" ? clearLiveTurnFields() : {};

    return {
      ...current,
      runtimeKind: snapshot.ref.runtimeKind,
      workingDirectory: snapshot.ref.workingDirectory,
      status,
      title: snapshot.title,
      pendingApprovals: snapshot.pendingApprovals,
      pendingQuestions: snapshot.pendingQuestions,
      ...liveTurnFields,
    };
  }

  return {
    ...current,
    runtimeKind: snapshot.ref.runtimeKind,
    workingDirectory: snapshot.ref.workingDirectory,
    status: statusWithoutRuntimePresence(current),
    pendingApprovals: [],
    pendingQuestions: [],
    ...clearLiveTurnFields(),
  };
};
