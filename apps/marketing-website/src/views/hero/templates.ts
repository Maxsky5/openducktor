// The templates of the hero view. HeroView.astro renders them, and the scene clones them by name.
import type { CardActionsData } from "../../replica/board/model";
import {
  type Notification,
  sessionNotification,
  workflowNotification,
} from "../../replica/vocabulary";
import { TASKS } from "../../sample/tasks";

/** The buttons and the sessions that the cards of the board show during the scene. */
export const CARD_ACTIONS = {
  "planner-starting": { session: { role: "Planner", status: "Starting" } },
  "planner-running": { session: { role: "Planner", status: "Running" } },
  "request-qa": { action: "Request QA Review" },
  "qa-starting": { session: { role: "QA", status: "Starting" } },
  "qa-running": { session: { role: "QA", status: "Running" } },
  approve: { action: "Approve Task" },
  "open-builder": { action: "Open Builder" },
} as const satisfies Record<string, CardActionsData>;

/** The notifications of the scene. */
export const TOASTS = {
  "toast-qa": workflowNotification("ai_review", TASKS.k3x9.title),
  "toast-review": workflowNotification("human_review", TASKS.r9c2.title),
  "toast-closed": workflowNotification("closed", TASKS.t4n8.title),
  "toast-input": sessionNotification(
    "Builder",
    TASKS.p6d4.title,
    "Which action should the empty notebook offer first?",
  ),
} satisfies Record<string, Notification>;

/** The merged pull request badge, and the card of the task that arrives in Backlog. */
export type HeroTemplate = keyof typeof CARD_ACTIONS | keyof typeof TOASTS | "merged" | "new-task";
