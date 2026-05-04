import type { LiveAgentSessionStatus } from "../ports/agent-engine";

export type LiveAgentSessionClassification =
  | "waiting_for_question"
  | "waiting_for_permission"
  | "retrying"
  | "running"
  | "idle";

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
