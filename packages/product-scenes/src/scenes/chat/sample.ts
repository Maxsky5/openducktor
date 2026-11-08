// The sample data of the chat scene: the chat, its prompts, the tasks that it creates, and the
// templates. The view renders the templates, and the timeline clones them by name. The prompts,
// tasks, and model are fictional.
import type { NavEntry } from "../../replicas/shell/nav";
import type { StartupStep } from "../../replicas/studio/StartupProgress";
import { NAV_SESSIONS } from "../../sample/nav";
import type { Session } from "../../sample/sessions";
import type { ChatTask } from "../../replicas/tasks/model";
import { TASKS } from "../../sample/tasks";
import { REPOSITORY_PATH, taskId, WORKSPACE } from "../../sample/workspace";

export const CHAT = {
  title: "Plan the export feature",
  directory: REPOSITORY_PATH,
  role: "Product planner",
};

/** The chat session after the turn: 18.4K tokens of the 200K window of the sample model, at the
 * Fast speed. */
export const CHAT_SESSION = {
  runtime: "claude",
  model: "claude-lyra-3",
  effort: "high",
  window: 200_000,
  used: 9.2,
  speed: "fast",
} satisfies Session;

/** The context use after the task search, in percent of the window. */
export const SEARCH_USED = 4.8;

/** The slash query that the visitor types. It matches the three custom prompts. */
export const QUERY = "/tasks-";

/** The text that the visitor types after the command chip. */
export const REQUEST = "Export notebooks to Markdown and PDF";

/** The Backlog task of the hero board that the search finds. */
export const EXISTING = taskId("m2q7");

/** The first command with `$ARGUMENTS` replaced by the request: the message that Send posts. */
export const MESSAGE = `Split this request into tasks that each fit in one pull request. Search the board first, and do not create a task that already exists.\n\nRequest: ${REQUEST}`;

export const SEARCH = {
  running: "title: export · limit: 10",
  done: "1 result · title: export · limit: 10",
};

/**
 * The task that the visitor opens from the chat. It is a task, not a feature, so its Builder can
 * start from Backlog.
 */
export const MENU_TASK: ChatTask = {
  id: "w5j3",
  ...TASKS.w5j3,
  description:
    "Add an Export item to the notebook menu. It saves the notebook as Markdown, and it shows an error when the export fails.",
  labels: ["export", "ui"],
  time: "10:24:26 AM",
};

/** The tasks that the chat creates, in the order of the tool calls. */
export const CREATED_TASKS: ChatTask[] = [
  {
    id: "q7d1",
    ...TASKS.q7d1,
    description: `Save a notebook as a PDF file. Reuse the Markdown export of \`${EXISTING}\`.`,
    labels: ["export", "pdf"],
    time: "10:24:21 AM",
  },
  MENU_TASK,
];

/** The chat in the sidebar, a session without a task. */
export const CHAT_ENTRY = {
  workspace: WORKSPACE,
  id: "plan-chat",
  title: CHAT.title,
  runtime: CHAT_SESSION.runtime,
} as const satisfies NavEntry;

/** The Builder session of the menu task in the sidebar. */
export const BUILDER = NAV_SESSIONS["menu-build"];

/** The origin of the startup notification of the Builder: the repository and the task. */
export const ORIGIN = `${WORKSPACE} · ${taskId(MENU_TASK.id)}`;

/**
 * The startup steps of the Builder: a new task worktree on a new branch from the remote target
 * origin/main, without copied files or worktree actions. The worktree and the upstream steps have
 * details.
 */
export const STEPS: readonly StartupStep[] = [
  { id: "checkout", label: "Create task worktree", details: true },
  { id: "upstream", label: "Set branch upstream", details: true },
  { id: "session", label: "Start session", details: false },
];

/** The task details and the start dialog of the Builder. */
export type ChatTemplate = "sheet" | "builder-dialog";
