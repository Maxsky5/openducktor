import type {
  LiveAgentSessionClassification,
  LiveAgentSessionRef,
  LiveAgentSessionSnapshot,
  LiveAgentSessionStatus,
  LiveSessionTruth,
} from "../ports/agent-engine";

export type LiveAgentSessionClassificationInput = {
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
}: LiveAgentSessionClassificationInput): LiveAgentSessionClassification => {
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
  classification: LiveAgentSessionClassification,
): "running" | "idle" => {
  if (classification === "running" || classification === "retrying") {
    return "running";
  }
  return "idle";
};

export const toLiveSessionTruthFromSnapshot = ({
  ref,
  runtimeId,
  snapshot,
}: {
  ref: LiveAgentSessionRef;
  runtimeId: string | null;
  snapshot: LiveAgentSessionSnapshot | null;
}): LiveSessionTruth => {
  if (!snapshot) {
    return {
      type: "stale",
      classification: "stale",
      ref,
      runtimeId,
      pendingApprovals: [],
      pendingQuestions: [],
    };
  }

  const classification = classifyLiveAgentSessionSnapshot(snapshot);
  return {
    type: "live",
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

export const toPersistedOnlyLiveSessionTruth = ({
  ref,
  reason,
}: {
  ref: LiveAgentSessionRef;
  reason: string;
}): LiveSessionTruth => ({
  type: "persisted_only",
  classification: "persisted_only",
  ref,
  runtimeId: null,
  reason,
  pendingApprovals: [],
  pendingQuestions: [],
});
