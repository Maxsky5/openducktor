// The sample data of the Start Builder scene of the mobile app. The board of Fieldnotes shows the
// tasks before the Builder of the search shortcut task starts: the planned tasks wait in Ready for
// Dev with Start Builder, the next step of the workflow. The Builder starts on the default target
// branch with the model and the effort of the role default. Its first start creates the task
// worktree, so the start sheet shows the startup progress. The tool calls and the times are
// fictional.
import type { StartupTraceStep } from "../../replicas/mobile/StartupTrace";
import type { BoardCard } from "../../replicas/mobile/TaskBoard";
import type { MobileCall } from "../../replicas/mobile/ToolRun";
import type { LaneId } from "../../replicas/vocabulary";
import { BUILDER_TOOLS, codexCommand } from "../../sample/mobile";
import { taskId, WORKSPACE } from "../../sample/workspace";

/** The default target branch of the repository, as the branch picker names it. */
export const TARGET = "origin/main";

/**
 * The rows of the first start of the Builder, as startupTraceRows lists them for a new task
 * worktree: the setup steps of the host, then the session start. The repository copies no file
 * into the worktree, so the copy step does not show.
 */
export const STARTUP_STEPS = [
  { id: "checkout", label: "Create task worktree" },
  { id: "upstream", label: "Set branch upstream" },
  { id: "session", label: "Start session" },
] as const satisfies readonly StartupTraceStep[];

/** The origin of the start under its phase: the workspace, the task, and the role. */
export const STARTUP_ORIGIN = `${WORKSPACE} · ${taskId("k3x9")} · build`;

/** The effort levels of the model, in the order of the track. */
export const EFFORTS = ["low", "medium", "high", "xhigh"] as const;

/** The steps of the step list, one for each part of the scene. */
export const STEPS = [
  "The Tasks tab shows the board one lane at a time.",
  "Swipe to Ready for dev. The pill and the lane title move with your finger.",
  "Tap Start Builder on the task that you want to build.",
  "Check the target branch, the model, and the effort. Then tap Start session.",
  "The Builder session opens, and the Builder starts the work.",
] as const;

/** The step of the start sheet, which the static frame shows. */
export const SHEET_STEP = 3;

/** The lane that the board shows first, and the lane of the task. */
export const FIRST_LANE = 0;
export const READY_LANE = 2;

/** The number of tasks in each lane. */
export const COUNTS = {
  open: 6,
  spec_ready: 2,
  ready_for_dev: 3,
  in_progress: 2,
  blocked: 0,
  ai_review: 1,
  human_review: 1,
  closed: 0,
} as const satisfies Record<LaneId, number>;

const START_SPEC = { label: "Start Spec", role: "spec", appearance: "outline" } as const;
const START_PLANNER = { label: "Start Planner", role: "planner", appearance: "outline" } as const;

/** The cards of the lanes that the visitor sees. */
export const CARDS = {
  open: [
    { task: "m2q7", start: START_SPEC },
    { task: "e3k8", start: START_SPEC },
    { task: "c7v2", start: START_SPEC },
    { task: "n2r6", start: START_SPEC },
    { task: "w1j5", start: START_SPEC },
    { task: "g2s6", start: START_SPEC },
  ],
  spec_ready: [
    { task: "h5w3", start: START_PLANNER },
    { task: "q7d1", start: START_PLANNER },
  ],
  ready_for_dev: [
    {
      task: "k3x9",
      card: "shortcut",
      start: { label: "Start Builder", role: "build", appearance: "filled" },
    },
    { task: "b8t1", start: { label: "Start Builder", role: "build", appearance: "filled" } },
    { task: "h4t8", start: { label: "Start Builder", role: "build", appearance: "filled" } },
  ],
} as const satisfies Partial<Record<LaneId, readonly BoardCard[]>>;

/** The first tool calls of the Builder, in order. */
export const TOOLS = {
  guide: BUILDER_TOOLS.guide,
  shell: { ...BUILDER_TOOLS.shell, time: "9:46:37 AM" },
  search: codexCommand("search", "rg -n openSearch src", "31ms", "9:46:41 AM"),
  list: { ...BUILDER_TOOLS.list, time: "9:46:44 AM" },
} as const satisfies Record<string, MobileCall>;

/**
 * The tool runs of the first turn: the calls before the first reply, and the call after it. The
 * first run folds when the reply follows it.
 */
export const RUNS = {
  reading: ["guide", "shell", "search"],
  listing: ["list"],
} as const satisfies Record<string, readonly (keyof typeof TOOLS)[]>;

/** The first reply of the Builder. */
export const PLAN =
  "The plan adds `useSearchShortcut` and calls it in the app shell. I write the hook first.";
