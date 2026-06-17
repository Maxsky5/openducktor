import {
  agentSessionStatusFromActivity,
  type AgentSessionRuntimeSnapshot as CoreAgentSessionRuntimeSnapshot,
} from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export type { AgentSessionRuntimeSnapshot } from "@openducktor/core";

type AvailableAgentSessionRuntimeSnapshot = Extract<
  CoreAgentSessionRuntimeSnapshot,
  { availability: "runtime" }
>;

const clearLiveTurnFields = (): Pick<AgentSessionState, "pendingUserMessageStartedAt"> => ({
  pendingUserMessageStartedAt: undefined,
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

const nextPendingApprovals = (
  current: AgentSessionState,
  snapshot: AvailableAgentSessionRuntimeSnapshot,
): AgentSessionState["pendingApprovals"] =>
  current.pendingApprovals.length === 0 && snapshot.pendingApprovals.length === 0
    ? current.pendingApprovals
    : snapshot.pendingApprovals;

const nextPendingQuestions = (
  current: AgentSessionState,
  snapshot: AvailableAgentSessionRuntimeSnapshot,
): AgentSessionState["pendingQuestions"] =>
  current.pendingQuestions.length === 0 && snapshot.pendingQuestions.length === 0
    ? current.pendingQuestions
    : snapshot.pendingQuestions;

type MissingRuntimeSnapshotPolicy = "preserve_local_runtime_state" | "settle_runtime_state";

const isTerminalLocalSessionStatus = (status: AgentSessionState["status"]): boolean =>
  status === "stopped" || status === "error";

const settleMissingRuntimeSnapshot = (current: AgentSessionState): AgentSessionState => {
  const status =
    current.status === "starting" || isTerminalLocalSessionStatus(current.status)
      ? current.status
      : "idle";
  return {
    ...current,
    status,
    pendingApprovals: [],
    pendingQuestions: [],
    pendingUserMessageStartedAt: undefined,
  };
};

export const shouldObserveAgentSessionRuntimeSnapshot = (
  snapshot: CoreAgentSessionRuntimeSnapshot,
): boolean => {
  return snapshot.availability === "runtime" && snapshot.classification !== "idle";
};

const applyAvailableRuntimeSnapshotToSession = (
  current: AgentSessionState,
  snapshot: AvailableAgentSessionRuntimeSnapshot,
): AgentSessionState => {
  const status = statusFromRuntimeSnapshot(current, snapshot);
  const liveTurnFields = status === "idle" ? clearLiveTurnFields() : {};

  return {
    ...current,
    status,
    title: snapshot.title,
    pendingApprovals: nextPendingApprovals(current, snapshot),
    pendingQuestions: nextPendingQuestions(current, snapshot),
    ...liveTurnFields,
  };
};

export const applyRuntimeSnapshotToSession = (
  current: AgentSessionState,
  snapshot: CoreAgentSessionRuntimeSnapshot,
  missingSnapshotPolicy: MissingRuntimeSnapshotPolicy,
): AgentSessionState => {
  if (snapshot.availability === "runtime") {
    return applyAvailableRuntimeSnapshotToSession(current, snapshot);
  }

  return missingSnapshotPolicy === "preserve_local_runtime_state"
    ? current
    : settleMissingRuntimeSnapshot(current);
};
