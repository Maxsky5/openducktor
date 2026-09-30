// Sample data of the workspace chat tile. The prompts, tasks, and model are fictional.
import type { Session } from "./sessions";
import { type Task, TASKS, type TaskKey } from "./tasks";
import { REPOSITORY_PATH, taskId } from "./workspace";

/** A task that the chat creates, with the description, the labels, and the time of its tool call. */
export type ChatTask = Task & {
  id: TaskKey;
  description: string;
  labels: string[];
  time: string;
};

export const CHAT = {
  title: "Plan the export feature",
  directory: REPOSITORY_PATH,
  role: "Product planner",
};

/** The chat session after the turn: 18.4K tokens of the 200K window of the sample model. */
export const CHAT_SESSION = {
  runtime: "claude",
  model: "claude-lyra-3",
  effort: "high",
  window: 200_000,
  used: 9.2,
} satisfies Session;

/** The context use after the task search, in percent of the window. */
export const SEARCH_USED = 4.8;

/** Custom reusable prompts whose trigger matches the typed query, in catalog order. */
export const COMMANDS = [
  {
    trigger: "tasks-from-request",
    description: "Split a request into tasks that each fit in one pull request.",
  },
  {
    trigger: "tasks-from-bug",
    description: "Write a bug task with the steps to reproduce and the expected result.",
  },
  {
    trigger: "tasks-cleanup",
    description: "Find duplicate and stale tasks in the backlog.",
  },
];

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

/** The tasks that the chat creates, in the order of the tool calls. */
export const CREATED_TASKS: ChatTask[] = [
  {
    id: "q7d1",
    ...TASKS.q7d1,
    description: `Save a notebook as a PDF file. Reuse the Markdown export of \`${EXISTING}\`.`,
    labels: ["export", "pdf"],
    time: "10:24:21 AM",
  },
  {
    id: "w5j3",
    ...TASKS.w5j3,
    description:
      "Add Markdown and PDF items to the notebook menu. Show an error when an export fails.",
    labels: ["export", "ui"],
    time: "10:24:26 AM",
  },
];
