// Text copied from the desktop app. Sources: packages/core/src/services/kanban-mapper.ts,
// packages/frontend/src/components/features/kanban/task-action-ui.tsx, and
// packages/frontend/src/features/notifications/notification-copy.ts.

/** The lanes of the Kanban board, in the order of the board. */
export const LANES = [
  "open",
  "spec_ready",
  "ready_for_dev",
  "in_progress",
  "blocked",
  "ai_review",
  "human_review",
  "closed",
] as const;
export type LaneId = (typeof LANES)[number];

export const LANE_TITLES = {
  open: "Backlog",
  spec_ready: "Spec Ready",
  ready_for_dev: "Ready for Dev",
  in_progress: "In Progress",
  blocked: "Blocked / Needs Input",
  ai_review: "AI Review",
  human_review: "Human Review",
  closed: "Done",
} satisfies Record<LaneId, string>;

/** The kinds of task of the task cards. */
export type TaskKind = "task" | "feature" | "bug";
/** The priorities that the scenes show, from P1, the most urgent, to P3. */
export type Priority = 1 | 2 | 3;

export type Role = "Spec" | "Planner" | "Builder" | "QA";

/** The pages of the app in the sidebar navigation. */
export type AppPage = "kanban" | "workflows" | "chats";
export type SessionStatus = "Running" | "Starting" | "Waiting input";
/** The activity of the session of a task, as its tab, its composer, and its card show it. */
export type Activity = "working" | "waiting" | "idle";

export type CardAction =
  | "Start Spec"
  | "Open Spec"
  | "Start Planner"
  | "Start Builder"
  | "Address QA Feedbacks"
  | "Request QA Review"
  | "Approve Task"
  | "Request Changes"
  | "Open Builder";

export const PRIMARY_ACTIONS: ReadonlySet<CardAction> = new Set([
  "Start Builder",
  "Address QA Feedbacks",
  "Request QA Review",
  "Approve Task",
]);

/** The copy of an in-app notification. */
export type Notification = { title: string; body: string };

/** The workflow notifications of notification-copy.ts, for the statuses that the views reach. */
const WORKFLOW_NOTIFICATIONS = {
  ai_review: { title: "Ready for QA", body: "The implementation is ready for QA review." },
  human_review: { title: "Review", body: "Review the changes and approve or request updates." },
  closed: { title: "Closed", body: "This task is closed." },
} satisfies Partial<Record<LaneId, Notification>>;

/** The notification when a task of title `task` enters `status`. */
export function workflowNotification(
  status: keyof typeof WORKFLOW_NOTIFICATIONS,
  task: string,
): Notification {
  const copy = WORKFLOW_NOTIFICATIONS[status];
  return { title: `${copy.title} - ${task}`, body: copy.body };
}

/**
 * The notification of an agent session of `role` on the task of title `task`. A new session says
 * that it started. A session that waits for input shows its question.
 */
export function sessionNotification(
  role: Role,
  task: string,
  body = "Session started.",
): Notification {
  return { title: `${role} - ${task}`, body };
}

/** The composer placeholders of agent-session-waiting-input.ts for one pending request. */
export const WAITING = {
  question: "Answer the pending question above to continue",
  approval: "Respond to the pending approval request above to continue",
} as const;

export type Request = keyof typeof WAITING;
