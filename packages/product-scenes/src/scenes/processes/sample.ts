// The sample data of the processes scene. The Builder of the empty notebook task works on Claude
// Code in the worktree of its task, and it starts the dev server of Fieldnotes there. Sam still has
// a test watcher in the repository checkout. The next read of the processes finds both commands.
// The session page shows the task, so its worktree is first and has the This task badge.
// src/copied-processes.test.ts gives the same checkouts to the view model of the app and compares
// the titles, the order, and the counts.
import type { BoardData } from "../../replicas/board/model";
import type { ProcessCommand, ProcessGroup } from "../../replicas/processes/model";
import type { NavEntry } from "../../replicas/shell/nav";
import type { RailTones } from "../../replicas/studio/model";
import type { CallData } from "../../replicas/transcript/model";
import { CARDS } from "../../sample/board";
import { bash, call, edit } from "../../sample/calls";
import { NAV_SESSIONS } from "../../sample/nav";
import { KICKOFF, TASK_ID } from "../../sample/studio";
import type { Session } from "../../sample/sessions";
import { TASKS, type TaskKey } from "../../sample/tasks";
import { taskId, WORKSPACE } from "../../sample/workspace";

/** The task of the session page: the empty notebook, whose Builder serves the app. */
export const TASK: TaskKey = "p6d4";

/** The Builder session of the task on Claude Code. */
export const SESSION = {
  runtime: "claude",
  model: "claude-lyra-3",
  effort: "medium",
  window: 200_000,
  used: 31.4,
} satisfies Session;

/** The workflow rail: Spec and Planner are done, and the Builder works. */
export const TONES: RailTones = ["done", "done", "in_progress", "blocked"];

/** The quick action of the task, which the working Builder disables. */
export const ACTION = "Start Implementation";

/** The Builder session of the task in the sidebar. */
export const BUILDER_ENTRY = NAV_SESSIONS["empty-build"];

/** The sidebar of the static frame, on the Kanban page: the Planner of another task also runs. */
export const NAV: readonly NavEntry[] = [
  BUILDER_ENTRY,
  NAV_SESSIONS["titles-planner"],
  NAV_SESSIONS["typing-qa"],
  NAV_SESSIONS["tags-chat"],
];

/** The sidebar at the start: the session page of the Builder is open. */
export const START_NAV: readonly NavEntry[] = NAV.map((entry) =>
  entry.id === BUILDER_ENTRY.id ? { ...entry, selected: true } : entry,
);

/**
 * The Kanban board after the visitor leaves the session page. The tasks of the sidebar sessions
 * keep their lanes, and the window shows the first lanes.
 */
export const BOARD: BoardData = {
  open: [CARDS.sync],
  spec_ready: [
    { task: CARDS.titles.task, session: { role: "Planner", status: "Running" }, links: ["Spec"] },
  ],
  in_progress: [CARDS.empty],
  human_review: [CARDS.typing],
};

/** The kickoff message of the Builder: the build kickoff of the built-in workflow. */
export const KICKOFF_MESSAGE = {
  time: "10:01:52 AM",
  text: KICKOFF.build.replaceAll(TASK_ID, taskId(TASK)),
} as const;

/** The first answer of the Builder. */
export const INTRO = "I will read the empty notebook view and its tests first.";

/** The reads of the Builder before the scene. */
export const READ_CALLS: readonly CallData[] = [
  call("read-view", {
    tool: "read",
    name: "Read",
    summary: "src/notebook/EmptyNotebook.tsx",
    file: true,
    duration: "9ms",
    time: "10:02:01 AM",
  }),
  call("read-test", {
    tool: "read",
    name: "Read",
    summary: "src/notebook/EmptyNotebook.test.tsx",
    file: true,
    duration: "7ms",
    time: "10:02:02 AM",
  }),
];

/** The plan of the Builder after the reads. */
export const PLAN =
  "The view shows an empty list and no next step. I will add a short guide and a Create a note button.";

/** The edits and the tests of the Builder before the scene. */
export const EDIT_CALLS: readonly CallData[] = [
  edit("view", "src/notebook/EmptyNotebook.tsx", { add: 31, del: 6 }, "0.2s", "10:02:40 AM"),
  edit("style", "src/notebook/empty-notebook.css", { add: 18, del: 0 }, "0.1s", "10:02:52 AM"),
  bash("test", "bun test src/notebook", "1.9s", "10:03:05 AM"),
];

/** The text of the Builder after the tests. */
export const BEFORE_SERVER =
  "The empty notebook now explains what to do, with a Create a note button. The tests pass. Next, I start the dev server to check the page.";

/** The command that serves the app. Claude Code runs it in the background, so the call ends at once. */
export const SERVER_CALL = bash("serve", "bun run dev", "0.3s", "10:03:11 AM");

/** The text of the Builder after the dev server starts. Backticks mark the inline code. */
export const AFTER_SERVER =
  "`bun run dev` serves the app on port 5173. I will open the empty Travel notebook and check the new text.";

/** The dev server of the Builder at the root of the task worktree: bun, Vite, and esbuild. */
export const SERVER: ProcessCommand = {
  id: "serve",
  directory: "",
  command: "bun run dev",
  ports: [5173],
  pid: 51207,
  processes: 3,
};

/** The test watcher of Sam in the search folder of the repository checkout: one process. */
export const WATCHER: ProcessCommand = {
  id: "watch",
  directory: "src/search",
  command: "bun test --watch",
  ports: [],
  pid: 48213,
  processes: 1,
};

/** The worktree of the task, which the session page shows. */
export const TASK_CHECKOUT: ProcessGroup = {
  id: "task",
  kind: "worktree",
  title: TASKS[TASK].title,
  subtitle: taskId(TASK),
  focused: true,
  commands: [SERVER],
};

/** The repository checkout of the workspace. */
export const REPOSITORY_CHECKOUT: ProcessGroup = {
  id: "repository",
  kind: "repository",
  title: WORKSPACE,
  focused: false,
  commands: [WATCHER],
};

/** The checkouts when the flyout opens. */
export const BEFORE_STOP: readonly ProcessGroup[] = [TASK_CHECKOUT, REPOSITORY_CHECKOUT];

/** The checkouts after the stop of the watcher, while the session page of the task shows. */
export const AFTER_STOP: readonly ProcessGroup[] = [TASK_CHECKOUT];

/** The checkouts on the Kanban page, which has no task: the floating window of the static frame. */
export const ON_BOARD: readonly ProcessGroup[] = [{ ...TASK_CHECKOUT, focused: false }];
