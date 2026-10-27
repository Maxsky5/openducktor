import {
  BUILTIN_WORKFLOW_NOTIFICATION_LABELS,
  BUILTIN_WORKFLOW_NOTIFICATION_DESCRIPTIONS,
  type BuiltinNotificationKind,
} from "@openducktor/workflows";
import type { AgentNotificationKind } from "@openducktor/contracts";

/** A notification that Settings shows: an agent notification or one of the built-in workflow. */
export type SettingsNotificationKind = AgentNotificationKind | BuiltinNotificationKind;

export const NOTIFICATION_KIND_LABELS = {
  "agent.permission_requested": "Permission Prompt",
  "agent.question_asked": "Structured Question",
  "agent.session_error": "Agent Session Error",
  "agent.session_started": "Agent Session Started",
  "agent.session_idle": "Agent Session Idle",
  ...BUILTIN_WORKFLOW_NOTIFICATION_LABELS,
} satisfies Record<SettingsNotificationKind, string>;

export const NOTIFICATION_KIND_DESCRIPTIONS = {
  "agent.permission_requested": "A Permission Prompt needs your input.",
  "agent.question_asked": "A Structured Question needs your input.",
  "agent.session_error": "An Agent Session enters a new error episode.",
  "agent.session_started": "A new root or parent Agent Session starts.",
  "agent.session_idle": "A running Agent Session becomes idle or finishes successfully.",
  ...BUILTIN_WORKFLOW_NOTIFICATION_DESCRIPTIONS,
} satisfies Record<SettingsNotificationKind, string>;
