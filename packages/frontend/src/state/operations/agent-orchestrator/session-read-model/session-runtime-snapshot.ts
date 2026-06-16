import {
  agentSessionStatusFromActivity,
  type AgentSessionRuntimeSnapshot as CoreAgentSessionRuntimeSnapshot,
} from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export type { AgentSessionRuntimeSnapshot } from "@openducktor/core";
export type AvailableAgentSessionRuntimeSnapshot = Extract<
  CoreAgentSessionRuntimeSnapshot,
  { availability: "runtime" }
>;

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

const statusFromRuntimeSnapshot = (
  current: AgentSessionState,
  snapshot: AvailableAgentSessionRuntimeSnapshot,
): AgentSessionState["status"] => {
  if (current.status === "starting" && snapshot.classification === "idle") {
    return "starting";
  }
  return agentSessionStatusFromActivity(snapshot.classification);
};

export const shouldObserveAgentSessionRuntimeSnapshot = (
  snapshot: CoreAgentSessionRuntimeSnapshot,
): boolean => {
  return snapshot.availability === "runtime" && snapshot.classification !== "idle";
};

export const sessionRuntimeSnapshotHasPendingInput = (
  snapshot: CoreAgentSessionRuntimeSnapshot,
): boolean => {
  return snapshot.pendingApprovals.length > 0 || snapshot.pendingQuestions.length > 0;
};

export const applyAgentSessionRuntimeSnapshotToSession = (
  current: AgentSessionState,
  snapshot: CoreAgentSessionRuntimeSnapshot,
): AgentSessionState => {
  if (snapshot.availability === "runtime") {
    const status = statusFromRuntimeSnapshot(current, snapshot);
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
  };
};
