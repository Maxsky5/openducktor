import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import {
  approvalCapabilityWarning,
  approvalOutcomeEmphasis,
  approvalOutcomeLabel,
  resolveApprovalReplyOutcomes,
} from "@openducktor/frontend-core/sessions/pending-input/agent-session-approval-card-model";
import type { AgentApprovalRequest } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { SessionButtonVariant } from "../session-button";

export type PermissionReplyOption = {
  outcome: RuntimeApprovalReplyOutcome;
  label: string;
  variant: SessionButtonVariant;
};

export type PermissionReplyOptions = {
  /** The replies that both the request and the runtime support, in request order. */
  options: PermissionReplyOption[];
  /** Why the request offers no reply, or null. */
  warning: string | null;
};

/** The desktop `OUTCOME_BUTTON_VARIANTS`: primary, outline, and solid red replies. */
const VARIANTS = {
  primary: "default",
  secondary: "outline",
  destructive: "destructive",
} satisfies Record<ReturnType<typeof approvalOutcomeEmphasis>, SessionButtonVariant>;

/** The reply buttons of a Permission Prompt, from the outcomes that the runtime offers. */
export const buildPermissionReplyOptions = (
  request: AgentApprovalRequest,
  runtimeSupportedReplyOutcomes: readonly RuntimeApprovalReplyOutcome[] | null,
): PermissionReplyOptions => {
  const supportedOutcomes = resolveApprovalReplyOutcomes({
    requestSupportedReplyOutcomes: request.supportedReplyOutcomes,
    runtimeSupportedReplyOutcomes,
  });
  return {
    options: supportedOutcomes.map((outcome) => ({
      outcome,
      label: approvalOutcomeLabel(outcome, request),
      variant: VARIANTS[approvalOutcomeEmphasis(outcome)],
    })),
    warning: approvalCapabilityWarning({ supportedOutcomes, runtimeSupportedReplyOutcomes }),
  };
};

const MUTATION_LABELS = {
  mutating: "Can change files or state",
  read_only: "Read only",
  unknown: "Effect unknown",
} satisfies Record<NonNullable<AgentApprovalRequest["mutation"]>, string>;

/** What the requested operation can change, or null when the runtime does not say. */
export const approvalMutationLabel = (mutation: AgentApprovalRequest["mutation"]): string | null =>
  mutation ? MUTATION_LABELS[mutation] : null;
