import type { NotificationKind } from "@openducktor/contracts";

export const NOTIFICATION_KIND_LABELS = {
  "agent.permission_requested": "Permission Prompt",
  "agent.question_asked": "Structured Question",
  "agent.session_error": "Agent Session Error",
  "agent.session_started": "Agent Session Started",
  "agent.session_idle": "Agent Session Idle",
  "workflow.spec_ready": "Spec Ready",
  "workflow.ready_for_dev": "Ready for Dev",
  "workflow.in_progress": "In Progress",
  "workflow.blocked": "Task Blocked",
  "workflow.ai_review": "AI Review",
  "workflow.human_review": "Human Review",
  "workflow.closed": "Task Closed",
} satisfies Record<NotificationKind, string>;

export const NOTIFICATION_KIND_DESCRIPTIONS = {
  "agent.permission_requested": "A Permission Prompt needs your input.",
  "agent.question_asked": "A Structured Question needs your input.",
  "agent.session_error": "An Agent Session enters a new error episode.",
  "agent.session_started": "A new root or parent Agent Session starts.",
  "agent.session_idle": "A running Agent Session becomes idle or finishes successfully.",
  "workflow.spec_ready": "A Task moves to Spec Ready.",
  "workflow.ready_for_dev": "A Task moves to Ready for Dev.",
  "workflow.in_progress": "A Task moves to In Progress.",
  "workflow.blocked": "A Task moves to Blocked.",
  "workflow.ai_review": "A Task moves to AI Review.",
  "workflow.human_review": "A Task moves to Human Review.",
  "workflow.closed": "A Task moves to Closed.",
} satisfies Record<NotificationKind, string>;
