import {
  BUILTIN_WORKFLOW_NOTIFICATION_LABELS,
  BUILTIN_WORKFLOW_NOTIFICATION_DESCRIPTIONS,
  type BuiltinNotificationKind,
} from "@openducktor/workflows";
import type { AgentNotificationKind } from "@openducktor/contracts";

/** A notification that Settings shows: an agent notification or one of the built-in workflow. */
export type SettingsNotificationKind = AgentNotificationKind | BuiltinNotificationKind;

export const NOTIFICATION_KIND_LABELS = {
  "agent.permission_requested": "Permission request",
  "agent.question_asked": "Question",
  "agent.session_error": "Session error",
  "agent.session_started": "Session started",
  "agent.session_idle": "Session idle",
  ...BUILTIN_WORKFLOW_NOTIFICATION_LABELS,
} satisfies Record<SettingsNotificationKind, string>;

export const NOTIFICATION_KIND_DESCRIPTIONS = {
  "agent.permission_requested": "The agent needs permission to continue.",
  "agent.question_asked": "The agent has a question for you.",
  "agent.session_error": "The session reports an error.",
  "agent.session_started": "A main session starts.",
  "agent.session_idle": "The session becomes idle or finishes.",
  ...BUILTIN_WORKFLOW_NOTIFICATION_DESCRIPTIONS,
} satisfies Record<SettingsNotificationKind, string>;
