import type {
  AgentNotificationKind,
  TaskNotificationKind,
  NotificationKind,
} from "@openducktor/contracts";

export type SettingsNotificationKind = NotificationKind;

export const NOTIFICATION_KIND_LABELS = {
  "agent.permission_requested": "Permission request",
  "agent.question_asked": "Question",
  "agent.session_error": "Session error",
  "agent.session_started": "Session started",
  "agent.session_idle": "Session idle",
  "task.auto_close_blocked": "Task not closed",
} satisfies Record<AgentNotificationKind | TaskNotificationKind, string>;

export const NOTIFICATION_KIND_DESCRIPTIONS = {
  "agent.permission_requested": "The agent needs permission to continue.",
  "agent.question_asked": "The agent has a question for you.",
  "agent.session_error": "The session reports an error.",
  "agent.session_started": "A main session starts.",
  "agent.session_idle": "The session becomes idle or finishes.",
  "task.auto_close_blocked":
    "The pull request of a task merged, but the pull request sync could not close the task.",
} satisfies Record<AgentNotificationKind | TaskNotificationKind, string>;
