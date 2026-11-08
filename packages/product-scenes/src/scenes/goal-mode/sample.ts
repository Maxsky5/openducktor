// The sample data of the goal mode scene: the default goal of Start Implementation, the goal that a
// model writes, and the Builder session that works toward the goal on Codex. Codex starts each
// next goal turn by itself, so the turns have no user message. The times are fictional.
import type { StartupStep } from "../../replicas/studio/StartupProgress";
import type { Row, SessionData } from "../../replicas/transcript/model";
import { signature } from "../../sample/sessions";
import { BUILDER_SESSION, FIXED_FILES, HOOK_PATH, TASK_ID, TEST_PATH } from "../../sample/studio";
import { TASKS } from "../../sample/tasks";
import { WORKSPACE } from "../../sample/workspace";

const TITLE = TASKS.k3x9.title;

/**
 * The default goal of Start Implementation: builderGoal of
 * packages/workflows/src/builtin/spec-plan-build/definition.ts with the task filled in.
 */
export const DEFAULT_GOAL = [
  `Implement task ${TASK_ID} "${TITLE}" as its description, spec, and implementation plan define.`,
  "",
  "The goal is met when all of these are true:",
  "- Each requirement and acceptance criterion of the task works in the code.",
  "- Every check that the repository instructions require passes.",
  "- odt_apply_workflow_event with eventId build-completed succeeded.",
  "",
  `Use taskId ${TASK_ID} for every task-bound odt_* tool call. Change only what the task needs. Stop and ask the user when the task conflicts with the code, or a check fails for a cause outside the task.`,
].join("\n");

/**
 * The goal that Generate goal returns. It follows the Goal Writer prompt: one outcome sentence with
 * the task, binary criteria from the spec, the criteria of the default goal, the scope, when to
 * ask, and the taskId sentence.
 */
export const GENERATED_GOAL = [
  `Implement task ${TASK_ID} "${TITLE}": Cmd+K on macOS and Ctrl+K on Windows and Linux open the search dialog.`,
  "- The shortcut does nothing with Shift, in a text field, or in the note editor.",
  "- The shortcut does nothing while another dialog is open.",
  "- `bun test src/search` passes, with a test for each of these cases.",
  "- Every check that the repository instructions require passes.",
  "- odt_apply_workflow_event with eventId build-completed succeeded.",
  "",
  `Change only the search hook, the app shell, and their tests. Use taskId ${TASK_ID} for every task-bound odt_* tool call. Ask the user when the spec and the code conflict.`,
].join("\n");

/** The Builder session on Codex, with its context use after the last goal turn. */
export const GOAL_SESSION = BUILDER_SESSION;

/** The context use of the Builder after each goal turn, in percent of the window. */
export const TURN_USE = [11.6, 19.2, GOAL_SESSION.used] as const;

/** The startup steps of a new task worktree on a new branch from origin/main. */
export const STEPS: readonly StartupStep[] = [
  { id: "checkout", label: "Create task worktree", details: true },
  { id: "upstream", label: "Set branch upstream", details: true },
  { id: "session", label: "Start session", details: false },
];

/** The origin of the startup progress: the repository and the task. */
export const ORIGIN = `${WORKSPACE} · ${TASK_ID}`;

/** The files of the change: the hook with its dialog check, the app shell, and the tests. */
export const GOAL_FILES = FIXED_FILES.filter(
  (file) => file.path !== "src/search/search-dialog.tsx",
);

const sig = signature(GOAL_SESSION);

/** The goal turns of the Builder. Each turn ends with its time and its final message. */
const TURNS = {
  write: [
    {
      kind: "tool",
      id: "read-task",
      tool: "tool",
      name: "read_task",
      args: TASK_ID,
      duration: "131ms",
      time: "09:46:32 AM",
    },
    {
      kind: "tool",
      id: "read-guide",
      tool: "read",
      name: "Read",
      args: "AGENTS.md",
      duration: "6ms",
      time: "09:46:35 AM",
    },
    { kind: "patch", id: "hook", path: HOOK_PATH, change: "A", add: 21, del: 0 },
    { kind: "patch", id: "shell", path: "src/app/app-shell.tsx", change: "M", add: 3, del: 0 },
    {
      kind: "agent",
      id: "final",
      signature: sig,
      worked: "1m04s",
      paragraphs: [
        "The hook opens search with `Cmd+K` and `Ctrl+K`, and the app shell mounts it once. The tests come next.",
      ],
    },
  ],
  test: [
    { kind: "patch", id: "test", path: TEST_PATH, change: "A", add: 76, del: 0 },
    {
      kind: "tool",
      id: "run",
      tool: "bash",
      name: "Bash",
      args: "bun test src/search",
      duration: "2.4s",
      time: "09:48:12 AM",
    },
    {
      kind: "agent",
      id: "final",
      signature: sig,
      worked: "52s",
      paragraphs: [
        "`bun test src/search`: 6 tests pass. They cover `Shift`, text fields, the note editor, and an open dialog.",
      ],
    },
  ],
  submit: [
    {
      kind: "tool",
      id: "checks",
      tool: "bash",
      name: "Bash",
      args: "bun run lint && bun run typecheck",
      duration: "5.8s",
      time: "09:48:40 AM",
    },
    {
      kind: "tool",
      id: "commit",
      tool: "bash",
      name: "Bash",
      args: 'git commit -m "feat(search): open search with Cmd+K"',
      duration: "0.3s",
      time: "09:48:49 AM",
    },
    {
      kind: "workflow",
      id: "completed",
      title: "Build Completed",
      icon: "workflow",
      duration: "38ms",
      time: "09:48:52 AM",
    },
    {
      kind: "agent",
      id: "final",
      signature: sig,
      worked: "41s",
      paragraphs: [
        "The goal is met. Lint and the type check pass, the change is committed on the task branch, and the task is in AI Review.",
      ],
    },
  ],
} as const satisfies Record<string, readonly Row[]>;

export type TurnId = keyof typeof TURNS;
export const TURN_IDS = ["write", "test", "submit"] as const satisfies readonly TurnId[];

/** The row ids of a goal turn. */
export type GoalRowId<Turn extends TurnId> = (typeof TURNS)[Turn][number]["id"];

/** The Builder session with its three goal turns. */
export const GOAL_TRANSCRIPT: SessionData = {
  id: "goal",
  turns: TURN_IDS.map((id) => ({ id, rows: TURNS[id] })),
};

/** The start dialog of the Builder. */
export type GoalModeTemplate = "builder-dialog";
