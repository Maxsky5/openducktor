// The templates of the hero view. HeroView.astro renders them, and the scene clones them by name.
import type { CardActionsData } from "../../replica/board/model";
import {
  type Notification,
  sessionNotification,
  workflowNotification,
} from "../../replica/vocabulary";
import { modelPath } from "../../sample/models";
import { WAITING_QUESTION } from "../../sample/question";
import { TASKS } from "../../sample/tasks";
import { taskId } from "../../sample/workspace";

/** The buttons and the sessions that the cards of the board show during the scene. */
export const CARD_ACTIONS = {
  "planner-starting": { session: { role: "Planner", status: "Starting" } },
  "planner-running": { session: { role: "Planner", status: "Running" } },
  "request-qa": { action: "Request QA Review" },
  "qa-starting": { session: { role: "QA", status: "Starting" } },
  "qa-running": { session: { role: "QA", status: "Running" } },
  approve: { action: "Approve Task" },
  "builder-waiting": { session: { role: "Builder", status: "Waiting input" } },
  "builder-running": { session: { role: "Builder", status: "Running" } },
} as const satisfies Record<string, CardActionsData>;

/** The notifications of the scene. */
export const TOASTS = {
  "toast-qa": workflowNotification("ai_review", TASKS.k3x9.title),
  "toast-review": workflowNotification("human_review", TASKS.r9c2.title),
  "toast-closed": workflowNotification("closed", TASKS.t4n8.title),
  "toast-input": sessionNotification("Builder", TASKS.p6d4.title, WAITING_QUESTION.question),
} satisfies Record<string, Notification>;

/**
 * The session preview of the Builder that waits. The task skips the spec and the plan, so they are
 * optional, and QA waits for the build.
 */
export const PREVIEW = {
  title: TASKS.p6d4.title,
  taskId: taskId("p6d4"),
  kind: TASKS.p6d4.kind,
  priority: TASKS.p6d4.priority,
  status: "in_progress",
  tones: ["optional", "optional", "waiting_input", "blocked"],
  role: "build",
  runtime: "claude",
  model: `${modelPath({ runtime: "claude", model: "claude-lyra-3" })} · high`,
  question: WAITING_QUESTION,
  activity: "Active just now",
} as const;

/**
 * The merged pull request badge, the card of the task that arrives in Backlog, and the session
 * preview.
 */
export type HeroTemplate =
  | keyof typeof CARD_ACTIONS
  | keyof typeof TOASTS
  | "merged"
  | "new-task"
  | "preview";
