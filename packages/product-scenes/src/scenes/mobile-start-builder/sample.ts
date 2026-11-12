// The sample data of the Start Builder scene of the mobile app. The board of Fieldnotes shows the
// tasks before the Builder of the search shortcut task starts: the planned tasks wait in Ready for
// Dev with Start Builder, the next step of the workflow. The Builder starts on the default target
// branch with the model and the effort of the role default. The tool calls and the times are
// fictional.
import type { BoardCard } from "../../replicas/mobile/TaskBoard";
import type { MobileTool } from "../../replicas/mobile/TranscriptRows";
import type { LaneId } from "../../replicas/vocabulary";
import { BUILDER_TOOLS } from "../../sample/mobile";

/** The default target branch of the repository, as the branch picker names it. */
export const TARGET = "origin/main";

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
  open: 4,
  spec_ready: 1,
  ready_for_dev: 2,
  in_progress: 2,
  blocked: 0,
  ai_review: 1,
  human_review: 1,
  closed: 0,
} as const satisfies Record<LaneId, number>;

const START_SPEC = { label: "Start Spec", role: "spec", appearance: "outline" } as const;

/** The cards of the lanes that the visitor sees. */
export const CARDS = {
  open: [
    { task: "m2q7", start: START_SPEC },
    { task: "e3k8", start: START_SPEC },
    { task: "c7v2", start: START_SPEC },
    { task: "n2r6", start: START_SPEC },
  ],
  spec_ready: [
    { task: "h5w3", start: { label: "Start Planner", role: "planner", appearance: "outline" } },
  ],
  ready_for_dev: [
    {
      task: "k3x9",
      card: "shortcut",
      start: { label: "Start Builder", role: "build", appearance: "filled" },
    },
    { task: "b8t1", start: { label: "Start Builder", role: "build", appearance: "filled" } },
  ],
} as const satisfies Partial<Record<LaneId, readonly BoardCard[]>>;

/** The first tool calls of the Builder, in order. */
export const TOOLS = {
  guide: BUILDER_TOOLS.guide,
  shell: {
    type: "read",
    name: "read",
    summary: "src/app/AppShell.tsx",
    duration: "1ms",
    time: "9:46:37 AM",
  },
  search: {
    type: "search",
    name: "grep",
    summary: "openSearch",
    duration: "18ms",
    time: "9:46:41 AM",
  },
  list: { type: "list", name: "list", summary: "src/search", duration: "1ms", time: "9:46:44 AM" },
} as const satisfies Record<string, MobileTool>;

/** The first reply of the Builder. */
export const PLAN =
  "The plan adds `useSearchShortcut` and calls it in the app shell. I write the hook first.";
