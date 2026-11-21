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

/** How strongly a row shows the risk level of an auto-review denial. */
export type ToolDenialRiskTone = "neutral" | "warning" | "danger";

const RISKS = {
  low: { label: "Low risk", tone: "neutral" },
  medium: { label: "Medium risk", tone: "warning" },
  high: { label: "High risk", tone: "danger" },
  critical: { label: "Critical risk", tone: "danger" },
} as const satisfies Record<AgentToolDenialRiskLevel, { label: string; tone: ToolDenialRiskTone }>;

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
  /** A short category that names the reason, such as `Git Destructive`, else null. */
  category: string | null;
  /** The reason of the policy, or a note when the policy gave none. Null for no text. */
  reason: string | null;
  /** The risk level of an auto-review denial, else null. */
  risk: { label: string; tone: ToolDenialRiskTone } | null;
};

/** The Claude auto mode classifier gives a category in brackets, such as `[Git Destructive]`. */
const BRACKETED_CATEGORY = /^\[([^[\]]+)\]$/u;

export const readToolDenialPresentation = (denial: AgentToolDenial): ToolDenialPresentation => {
  const reason = denial.reason?.trim();
  const category = reason ? (BRACKETED_CATEGORY.exec(reason)?.[1]?.trim() ?? null) : null;
  return {
    label: TOOL_DENIAL_LABELS[denial.source],
    category,
    reason: category ? null : reason || MISSING_REASONS[denial.source],
    risk: denial.source === "auto_review" && denial.riskLevel ? RISKS[denial.riskLevel] : null,
  };
};

/** The Allow state of one denied call of a session, or null when the user cannot allow it. */
export const findDeniedAction = (
  deniedActions: readonly AgentSessionDeniedAction[] | undefined,
  callId: string,
): AgentSessionDeniedAction | null =>
  deniedActions?.find((action) => action.callId === callId) ?? null;

export const TOOL_DENIAL_ALLOW_HINT = "Lets the agent try this exact call again.";
export const TOOL_DENIAL_ALLOWED_LABEL = "Allowed";
export const TOOL_DENIAL_ALLOWED_MESSAGE = "You allowed this call. The agent can try it again.";
