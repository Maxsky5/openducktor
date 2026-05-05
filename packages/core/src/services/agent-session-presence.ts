import type {
  AgentSessionActivity,
  AgentSessionPresenceSnapshot,
  AgentSessionRef,
  LiveAgentSessionSnapshot,
  LiveAgentSessionStatus,
} from "../ports/agent-engine";

export type AgentSessionActivityInput = {
  status: LiveAgentSessionStatus;
  pendingApprovals: readonly unknown[];
  pendingQuestions: readonly unknown[];
};

/**
 * Classifies one normalized live runtime snapshot.
 *
 * Precedence is intentionally deterministic and runtime-agnostic:
 * live questions > live approvals > retry > busy > idle. Persisted pending
 * hints are recovery data only and must be resolved before calling this helper.
 */
export const classifyLiveAgentSessionSnapshot = ({
  status,
  pendingApprovals,
  pendingQuestions,
}: AgentSessionActivityInput): AgentSessionActivity => {
  if (pendingQuestions.length > 0) {
    return "waiting_for_question";
  }
  if (pendingApprovals.length > 0) {
    return "waiting_for_permission";
  }
  if (status.type === "retry") {
    return "retrying";
  }
  if (status.type === "busy") {
    return "running";
  }
  return "idle";
};

export const toLiveAgentSessionRuntimeStatus = (
  classification: AgentSessionActivity,
): "running" | "idle" => {
  if (classification === "running" || classification === "retrying") {
    return "running";
  }
  return "idle";
};

export const toAgentSessionPresenceSnapshotFromLiveSnapshot = ({
  ref,
  runtimeId,
  snapshot,
}: {
  ref: AgentSessionRef;
  runtimeId: string | null;
  snapshot: LiveAgentSessionSnapshot | null;
}): AgentSessionPresenceSnapshot => {
  if (!snapshot) {
    return {
      presence: "stale",
      classification: "stale",
      ref,
      runtimeId,
      pendingApprovals: [],
      pendingQuestions: [],
    };
  }

  if (!runtimeId) {
    throw new Error("Runtime session presence requires a live runtime id.");
  }

  const classification = classifyLiveAgentSessionSnapshot(snapshot);
  return {
    presence: "runtime",
    classification,
    ref,
    runtimeId,
    title: snapshot.title,
    startedAt: snapshot.startedAt,
    status: snapshot.status,
    agentSessionStatus: toLiveAgentSessionRuntimeStatus(classification),
    pendingApprovals: snapshot.pendingApprovals,
    pendingQuestions: snapshot.pendingQuestions,
  };
};

export const toPersistedOnlyAgentSessionPresenceSnapshot = ({
  ref,
  reason,
}: {
  ref: AgentSessionRef;
  reason: string;
}): AgentSessionPresenceSnapshot => ({
  presence: "persisted_only",
  classification: "persisted_only",
  ref,
  runtimeId: null,
  reason,
  pendingApprovals: [],
  pendingQuestions: [],
});
