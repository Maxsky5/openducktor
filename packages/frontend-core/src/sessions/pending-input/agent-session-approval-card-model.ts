import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import type { AgentApprovalRequest } from "../../types/agent-orchestrator";

export const resolveApprovalReplyOutcomes = ({
  requestSupportedReplyOutcomes,
  runtimeSupportedReplyOutcomes,
}: {
  requestSupportedReplyOutcomes?: readonly RuntimeApprovalReplyOutcome[] | undefined;
  runtimeSupportedReplyOutcomes: readonly RuntimeApprovalReplyOutcome[] | null;
}): RuntimeApprovalReplyOutcome[] => {
  if (!runtimeSupportedReplyOutcomes) {
    return [];
  }

  const requestOutcomes = requestSupportedReplyOutcomes ?? runtimeSupportedReplyOutcomes;
  const runtimeOutcomeSet = new Set(runtimeSupportedReplyOutcomes);
  const effectiveOutcomeSet = new Set<RuntimeApprovalReplyOutcome>();
  const effectiveOutcomes: RuntimeApprovalReplyOutcome[] = [];
  for (const outcome of requestOutcomes) {
    if (!runtimeOutcomeSet.has(outcome) || effectiveOutcomeSet.has(outcome)) {
      continue;
    }
    effectiveOutcomeSet.add(outcome);
    effectiveOutcomes.push(outcome);
  }
  return effectiveOutcomes;
};

/** The reply labels that both clients show. `approve_always` with a project grant saves it for the project. */
export const APPROVAL_OUTCOME_LABELS = {
  approve_once: "Approve once",
  approve_turn: "Approve for turn",
  approve_session: "Approve for session",
  approve_always: "Always allow",
  reject: "Reject",
} satisfies Record<RuntimeApprovalReplyOutcome, string>;

export const approvalOutcomeLabel = (
  outcome: RuntimeApprovalReplyOutcome,
  request: Pick<AgentApprovalRequest, "persistentGrant">,
): string =>
  outcome === "approve_always" && request.persistentGrant?.scope === "project"
    ? "Allow for project"
    : APPROVAL_OUTCOME_LABELS[outcome];

/** How strongly a reply button stands out: approve once is the main action, reject is destructive. */
export type ApprovalOutcomeEmphasis = "primary" | "secondary" | "destructive";

export const approvalOutcomeEmphasis = (
  outcome: RuntimeApprovalReplyOutcome,
): ApprovalOutcomeEmphasis => {
  if (outcome === "reject") return "destructive";
  if (outcome === "approve_once") return "primary";
  return "secondary";
};

/** Why a request offers no reply, or null when it offers at least one. */
export const approvalCapabilityWarning = ({
  supportedOutcomes,
  runtimeSupportedReplyOutcomes,
}: {
  supportedOutcomes: readonly RuntimeApprovalReplyOutcome[];
  runtimeSupportedReplyOutcomes: readonly RuntimeApprovalReplyOutcome[] | null;
}): string | null => {
  if (supportedOutcomes.length > 0) return null;
  return runtimeSupportedReplyOutcomes
    ? "This runtime does not support any declared approval outcomes for this request."
    : "Runtime approval capabilities are unavailable for this request. Refresh runtime checks or open the session again, then try again.";
};

/** True when the request has something to show. A request without content shows no card. */
export const hasApprovalRequestContent = (request: AgentApprovalRequest): boolean =>
  Boolean(
    request.title ||
    request.summary ||
    request.details ||
    request.command ||
    request.action ||
    request.tool ||
    request.affectedPaths?.length,
  );

/** The one-line description of a collapsed request. */
export const approvalRequestDescription = (request: AgentApprovalRequest): string | undefined =>
  [
    request.title,
    request.summary,
    request.command?.command,
    request.action?.name,
    request.tool?.name,
    request.details,
    request.affectedPaths?.[0],
  ].find((value) => value?.trim());

/** The tool input of a request without a command, as indented JSON, or null. */
export const approvalToolInputText = (request: AgentApprovalRequest): string | null =>
  request.tool?.input && !request.command ? JSON.stringify(request.tool.input, null, 2) : null;
