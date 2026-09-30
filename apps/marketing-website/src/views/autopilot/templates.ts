// The templates of the Autopilot view. AutopilotView.astro renders them, and the scene clones them
// by name.
import type { CardActionsData } from "../../replica/board/model";
import { type Notification, sessionNotification } from "../../replica/vocabulary";
import { TASKS } from "../../sample/tasks";

/** The roles that Autopilot starts. Each one has its card templates and its notification. */
export type AutopilotRole = "planner" | "builder" | "qa";

/** The task that goes through the workflow. */
const TASK = TASKS.c7v2.title;

/** The buttons and the sessions that the cards of the board show during the scene. */
export const CARD_ACTIONS = {
  "builder-waiting": { session: { role: "Builder", status: "Waiting input" } },
  "start-planner": { action: "Start Planner" },
  "start-builder": { action: "Start Builder" },
  "request-qa": { action: "Request QA Review" },
  "address-qa": { action: "Address QA Feedbacks" },
  "spec-running": { session: { role: "Spec", status: "Running" } },
  "planner-starting": { session: { role: "Planner", status: "Starting" } },
  "planner-running": { session: { role: "Planner", status: "Running" } },
  "builder-starting": { session: { role: "Builder", status: "Starting" } },
  "builder-running": { session: { role: "Builder", status: "Running" } },
  "qa-starting": { session: { role: "QA", status: "Starting" } },
  "qa-running": { session: { role: "QA", status: "Running" } },
  approve: { action: "Approve Task" },
} as const satisfies Record<string, CardActionsData> &
  Record<`${AutopilotRole}-${"starting" | "running"}`, CardActionsData>;

/** The notifications of the scene: a new session of each role, and a question of another task. */
export const TOASTS = {
  "toast-planner": sessionNotification("Planner", TASK),
  "toast-builder": sessionNotification("Builder", TASK),
  "toast-qa": sessionNotification("QA", TASK),
  "toast-question": sessionNotification(
    "Builder",
    TASKS.g2s6.title,
    "Two devices renamed the same tag. Which name should sync keep?",
  ),
} satisfies Record<string, Notification> & Record<`toast-${AutopilotRole}`, Notification>;

/** The QA verdict badge and the pull request badge of the task. */
export type AutopilotTemplate = keyof typeof CARD_ACTIONS | keyof typeof TOASTS | "rejected" | "pr";
