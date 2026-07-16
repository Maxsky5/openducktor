import type { AgentSessionRuntimeSnapshot } from "../ports/agent-engine";
import type {
  AgentPendingApprovalRequest,
  AgentPendingQuestionRequest,
  AgentSessionActivity,
  ExternalSessionId,
  SessionRef,
} from "../types/agent-orchestrator";

export type AgentSessionRuntimeActivity = AgentSessionActivity;

export type AgentSessionActivityInput = {
  runtimeActivity: AgentSessionRuntimeActivity;
  pendingApprovals: readonly unknown[];
  pendingQuestions: readonly unknown[];
};

/**
 * Classifies one normalized live runtime snapshot.
 *
 * Precedence is intentionally deterministic and runtime-agnostic:
 * live questions > live approvals > runtime activity. Persisted pending
 * hints are recovery data only and must be resolved before calling this helper.
 */
export const classifyAgentSessionActivity = ({
  runtimeActivity,
  pendingApprovals,
  pendingQuestions,
}: AgentSessionActivityInput): AgentSessionActivity => {
  if (pendingQuestions.length > 0) {
    return "waiting_for_question";
  }
  if (pendingApprovals.length > 0) {
    return "waiting_for_permission";
  }
  return runtimeActivity;
};

export const agentSessionStatusFromActivity = (
  classification: AgentSessionActivity,
): "running" | "idle" => {
  if (classification === "running" || classification === "retrying") {
    return "running";
  }
  return "idle";
};

export type AgentSessionRuntimeSnapshotSource = {
  parentExternalSessionId?: ExternalSessionId;
  title: string;
  startedAt: string;
  runtimeActivity: AgentSessionRuntimeActivity;
  pendingApprovals: AgentPendingApprovalRequest[];
  pendingQuestions: AgentPendingQuestionRequest[];
};

export const toAgentSessionRuntimeSnapshot = (
  input:
    | {
        ref: SessionRef;
        snapshot: AgentSessionRuntimeSnapshotSource;
      }
    | {
        ref: SessionRef;
        snapshot: null;
      },
): AgentSessionRuntimeSnapshot => {
  const { ref, snapshot } = input;
  if (!snapshot) {
    return toMissingAgentSessionRuntimeSnapshot(ref);
  }

  const classification = classifyAgentSessionActivity(snapshot);
  return {
    availability: "runtime",
    classification,
    ref,
    ...(snapshot.parentExternalSessionId
      ? { parentExternalSessionId: snapshot.parentExternalSessionId }
      : {}),
    title: snapshot.title,
    startedAt: snapshot.startedAt,
    pendingApprovals: snapshot.pendingApprovals,
    pendingQuestions: snapshot.pendingQuestions,
  };
};

export const toMissingAgentSessionRuntimeSnapshot = (
  ref: SessionRef,
): AgentSessionRuntimeSnapshot => ({
  availability: "missing",
  classification: "missing",
  ref,
  pendingApprovals: [],
  pendingQuestions: [],
});
