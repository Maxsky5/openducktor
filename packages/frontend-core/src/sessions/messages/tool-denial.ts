import type {
  AgentSessionDeniedAction,
  AgentToolDenial,
  AgentToolDenialRiskLevel,
  AgentToolDenialSource,
} from "@openducktor/contracts";

/** The label of a blocked call by the policy that denied it. */
export const TOOL_DENIAL_LABELS = {
  auto_mode: "Blocked by auto mode",
  permission_settings: "Blocked by permission settings",
  auto_review: "Blocked by auto-review",
  auto_review_timeout: "Auto-review timed out",
  read_only_role: "Blocked by read-only role",
} as const satisfies Record<AgentToolDenialSource, string>;

const RISK_LEVEL_LABELS = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
} as const satisfies Record<AgentToolDenialRiskLevel, string>;

/** What a row says when the policy gave no reason. Other sources show no text. */
const MISSING_REASONS = {
  auto_mode: null,
  permission_settings: null,
  auto_review: "Auto-review gave no reason.",
  auto_review_timeout: "The review timed out.",
  read_only_role: null,
} as const satisfies Record<AgentToolDenialSource, string | null>;

/** What the row of a blocked call shows. */
export type ToolDenialPresentation = {
  label: string;
  /** The reason of the policy, or a note when the policy gave none. Null for no text. */
  reason: string | null;
  /** `Risk: High` for an auto-review denial with a risk level, else null. */
  riskLabel: string | null;
};

export const readToolDenialPresentation = (denial: AgentToolDenial): ToolDenialPresentation => ({
  label: TOOL_DENIAL_LABELS[denial.source],
  reason: denial.reason?.trim() || MISSING_REASONS[denial.source],
  riskLabel:
    denial.source === "auto_review" && denial.riskLevel
      ? `Risk: ${RISK_LEVEL_LABELS[denial.riskLevel]}`
      : null,
});

/** The Allow state of one denied call of a session, or null when the user cannot allow it. */
export const findDeniedAction = (
  deniedActions: readonly AgentSessionDeniedAction[] | undefined,
  callId: string,
): AgentSessionDeniedAction | null =>
  deniedActions?.find((action) => action.callId === callId) ?? null;

export const TOOL_DENIAL_ALLOWED_MESSAGE = "You allowed this call. The agent can try it again.";
