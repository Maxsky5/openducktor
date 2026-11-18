// The sample data of the goal mode scene: the default goal of Start Implementation, the goal that a
// model writes, and the Builder session that works toward the goal on Codex. Codex starts each
// next goal turn by itself, so the turns have no user message. The times are fictional.
import type { StartupStep } from "../../replicas/studio/StartupProgress";
import type { Row, SessionData } from "../../replicas/transcript/model";
import { bash, catFile, edit, readTask } from "../../sample/calls";
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
 * ask, and the taskId sentence. The outcome comes first, so the new goal differs from the default
 * goal from its first word.
 */
export const GENERATED_GOAL = [
  `Cmd+K on macOS and Ctrl+K on Windows and Linux open the search dialog, for task ${TASK_ID} "${TITLE}".`,
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

/**
 * The goal turns of the Builder. The calls of each turn show as one tool run, which folds when the
 * final message of the turn comes. Each turn ends with its time and its final message.
 */
const TURNS = {
  write: [
    readTask(TASK_ID, "131ms", "09:46:32 AM"),
    catFile("read-guide", "AGENTS.md", "6ms", "09:46:35 AM"),
    edit("hook", HOOK_PATH, { add: 21, del: 0 }, "44ms", "09:47:02 AM"),
    edit("shell", "src/app/app-shell.tsx", { add: 3, del: 0 }, "37ms", "09:47:19 AM"),
    {
      kind: "agent",
      id: "final",
      signature: sig,
      worked: "1m4s",
      paragraphs: [
        "The hook opens search with `Cmd+K` and `Ctrl+K`, and the app shell mounts it once. The tests come next.",
      ],
    },
  ],
  test: [
    edit("test", TEST_PATH, { add: 76, del: 0 }, "52ms", "09:47:58 AM"),
    bash("run", "bun test src/search", "2.4s", "09:48:12 AM"),
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
    bash("checks", "bun run lint && bun run typecheck", "5.8s", "09:48:40 AM"),
    bash("commit", 'git commit -m "feat(search): open search with Cmd+K"', "312ms", "09:48:49 AM"),
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
const TURN_IDS = ["write", "test", "submit"] as const satisfies readonly TurnId[];

/** The row ids of a goal turn. */
export type GoalRowId<Turn extends TurnId> = (typeof TURNS)[Turn][number]["id"];

/** The Builder session with its three goal turns. */
export const GOAL_TRANSCRIPT: SessionData = {
  id: "goal",
  turns: TURN_IDS.map((id) => ({ id, rows: TURNS[id] })),
};

/** The start dialog of the Builder. */
export type GoalModeTemplate = "builder-dialog";
