// The sample data of the hero scene: the board and the sidebar of its static frame, and its
// templates. The view renders the templates, and the timeline clones them by name. The lanes keep
// the order of the product. Backlog sorts by priority, then puts the newest task first. The other
// lanes put waiting sessions first, then running sessions, then older activity.
import type { BoardData, CardActionsData } from "../../replicas/board/model";
import type { NavData } from "../../replicas/shell/nav";
import {
  type Notification,
  sessionNotification,
  workflowNotification,
} from "../../replicas/vocabulary";
import { CARDS } from "../../sample/board";
import { modelPath } from "../../sample/models";
import { NAV_SESSIONS } from "../../sample/nav";
import { WAITING_QUESTION } from "../../sample/question";
import { TASKS } from "../../sample/tasks";
import { taskId } from "../../sample/workspace";

/** The board of the first frame. */
export const BOARD: BoardData = {
  open: [CARDS.sync, CARDS.export],
  spec_ready: [CARDS.titles],
  in_progress: [CARDS.empty, CARDS.shortcut],
  ai_review: [CARDS.focus],
  human_review: [CARDS.typing],
};

/**
 * The sidebar of the first frame lists the sessions of all workspaces: the agents of the
 * Fieldnotes board, and the sessions of two other workspaces. Four agents run, and nobody waits
 * for you. Two sessions start later.
 */
export const HERO_NAV: NavData = {
  scope: "all",
  entries: [
    NAV_SESSIONS["shortcut-build"],
    NAV_SESSIONS["empty-build"],
    NAV_SESSIONS["focus-qa"],
    NAV_SESSIONS["api-build"],
    NAV_SESSIONS["titles-spec"],
    NAV_SESSIONS["typing-qa"],
    NAV_SESSIONS["tags-chat"],
    NAV_SESSIONS["theme-plan"],
    { ...NAV_SESSIONS["titles-planner"], later: true },
    { ...NAV_SESSIONS["shortcut-qa"], later: true },
  ],
};

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
