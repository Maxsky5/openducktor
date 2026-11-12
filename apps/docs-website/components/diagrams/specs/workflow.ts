import {
  Bot,
  ClipboardCheck,
  FileCheck,
  FileText,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Hammer,
  ListChecks,
  MoveRight,
  Play,
  Radio,
  ToggleRight,
  User,
  UserCheck,
} from "lucide-react";
import type { LaneId } from "@/lib/lanes";
import { chainDiagram } from "../chain";
import { defineDiagram } from "../define";
import type { Box, EdgeSpec, LayoutSpec, NodeData, NodeSpec, Port } from "../spec";

// The path of a task ----------------------------------------------------------------------------

const STEP_IDS = ["spec", "planner", "builder", "qa", "you"] as const;
type StepId = (typeof STEP_IDS)[number];

const STEPS = {
  spec: { number: 1, role: "Spec", does: "Asks you about open decisions, then writes the spec." },
  planner: {
    number: 2,
    role: "Planner",
    does: "Reads the spec and the code, and designs the change.",
  },
  builder: {
    number: 3,
    role: "Builder",
    does: "Writes the code and the tests in the task worktree.",
  },
  qa: { number: 4, role: "QA", does: "Checks the build against the spec and the plan." },
  you: {
    number: 5,
    role: "You",
    you: true,
    does: "Read the changes and the QA report, then approve.",
  },
} satisfies Record<StepId, NodeData["step"]>;

/** What each step saves on the task, and the lane of the task after the step. */
const RESULTS = {
  spec: { name: "Specification", Icon: FileText, lane: "spec_ready" },
  planner: { name: "Implementation Plan", Icon: ListChecks, lane: "ready_for_dev" },
  builder: { name: "Task branch commits", Icon: GitCommitHorizontal, lane: "ai_review" },
  qa: { name: "QA Report", Icon: ClipboardCheck, lane: "human_review" },
  you: { name: "Merge or pull request", Icon: GitMerge, lane: "closed" },
} satisfies Record<StepId, NodeData["artifact"] & { lane: LaneId }>;

/** Backlog, then the nodes of each step: the step, what it saves, and the lane after it. */
const NODES = Object.fromEntries<NodeSpec>([
  ["start", { type: "lane", data: { lane: "open" } }],
  ...STEP_IDS.flatMap((id): [string, NodeSpec][] => [
    [id, { type: "step", data: STEPS[id] }],
    [
      `${id}-artifact`,
      { type: "artifact", data: { name: RESULTS[id].name, Icon: RESULTS[id].Icon } },
    ],
    [`${id}-lane`, { type: "lane", data: { lane: RESULTS[id].lane } }],
  ]),
]);

type PathLayout = {
  width: number;
  height: number;
  start: Box;
  step: (index: number) => Box;
  artifact: (index: number) => Box;
  lane: (index: number) => Box;
  /** In a row, the next step reads the artifact from below. In a column, from above. */
  row: boolean;
  /** The distance of the handoff ports from the left of the steps and the artifacts. */
  handoff: { stepOut: number; stepIn: number; artifactIn: number; artifactOut: number };
  /** The skip line from Backlog to the Builder. */
  skip: EdgeSpec<string>;
  /** The line of the loop from QA back to the Builder, and its own ports. */
  loop: { ports?: Partial<Record<StepId, Port[]>>; edge: EdgeSpec<string> };
};

function pathLayout(layout: PathLayout): LayoutSpec<typeof NODES> {
  const { handoff, row } = layout;
  const stepPorts = (id: StepId): Port[] => [
    { id: "out", side: "bottom", at: handoff.stepOut },
    { id: "in", side: row ? "bottom" : "top", at: handoff.stepIn },
    ...(layout.loop.ports?.[id] ?? []),
  ];
  const artifactPorts: Port[] = [
    { id: "in", side: "top", at: handoff.artifactIn },
    { id: "out", side: row ? "top" : "bottom", at: handoff.artifactOut },
  ];
  const handoffs = STEP_IDS.flatMap((id, index): EdgeSpec<string>[] => {
    const next = STEP_IDS[index + 1];
    const save: EdgeSpec<string> = [`${id}.out`, `${id}-artifact.in`];
    return next ? [save, [`${id}-artifact.out`, `${next}.in`]] : [save];
  });
  return {
    width: layout.width,
    height: layout.height,
    boxes: Object.fromEntries([
      ["start", layout.start],
      ...STEP_IDS.flatMap((id, index): [string, Box][] => [
        [id, layout.step(index)],
        [`${id}-artifact`, layout.artifact(index)],
        [`${id}-lane`, layout.lane(index)],
      ]),
    ]),
    ports: Object.fromEntries(
      STEP_IDS.flatMap((id): [string, Port[]][] => [
        [id, stepPorts(id)],
        [`${id}-artifact`, artifactPorts],
      ]),
    ),
    edges: [["start.b", "spec.t"], layout.skip, ...handoffs, layout.loop.edge],
  };
}

const SKIP = { label: "Task or bug can skip", step: true, still: true };
const REJECTED = { label: "Rejected", kind: "reject", step: true } as const;

/**
 * The path of a task across the board. Each step saves an artifact that the next step reads, and
 * the task moves to a new lane. Every task can start with the Spec, and a task or a bug can skip
 * to the Builder. A loop sends a rejected build back to the Builder.
 */
export const workflow = defineDiagram({
  name: "workflow",
  label:
    "A task starts in Backlog. Every task can start with step 1, and a task or a bug can skip to step 3. 1, Spec: asks you about open decisions, then writes the spec. It saves the Specification, and the task moves to Spec Ready. 2, Planner: reads the spec and designs the change. It saves the Implementation Plan, and the task moves to Ready for Dev. 3, Builder: writes the code and the tests. It saves commits on the task branch, and the task moves to AI Review. 4, QA: checks the build. It saves the QA Report, and the task moves to Human Review. If QA rejects the build, the task goes back to the Builder. 5, You: read the changes and approve. The merge or pull request moves the task to Done.",
  nodes: NODES,
  // Desktop: the steps in a row. Each step saves an artifact below it, and the next step reads
  // it, so the line goes down into the artifact and up into the next step. The lane of the task
  // shows under each artifact.
  wide: pathLayout({
    width: 905,
    height: 356,
    start: { x: 15, y: 4, w: 110, h: 32 },
    step: (index) => ({ x: index * 170, y: 76, w: 140, h: 136 }),
    artifact: (index) => ({ x: 85 + index * 170, y: 250, w: 140, h: 56 }),
    lane: (index) => ({ x: 85 + index * 170, y: 318, w: 140, h: 34 }),
    row: true,
    handoff: { stepOut: 110, stepIn: 25, artifactIn: 25, artifactOut: 110 },
    skip: ["start.r", "builder.t", { ...SKIP, offset: 20, labelAt: { x: 140, y: 0 } }],
    loop: {
      ports: {
        qa: [{ id: "loop", side: "top", at: 20 }],
        builder: [{ id: "loop", side: "top", at: 120 }],
      },
      edge: ["qa.loop", "builder.loop", { ...REJECTED, offset: 24 }],
    },
  }),
  // Phone: the steps in a column, each with its artifact and lane below it.
  narrow: pathLayout({
    width: 360,
    height: 1022,
    start: { x: 104, y: 4, w: 110, h: 32 },
    step: (index) => ({ x: 28, y: 62 + index * 196, w: 262, h: 92 }),
    artifact: (index) => ({ x: 28, y: 180 + index * 196, w: 150, h: 52 }),
    lane: (index) => ({ x: 186, y: 189 + index * 196, w: 110, h: 34 }),
    row: false,
    handoff: { stepOut: 75, stepIn: 75, artifactIn: 75, artifactOut: 75 },
    skip: ["start.r", "builder.r", { ...SKIP, offset: 26 }],
    loop: { edge: ["qa.l", "builder.l", { ...REJECTED, offset: 16 }] },
  }),
});

// The lanes of Spec, Plan, Build ----------------------------------------------------------------

/** The lanes, in board order, with what a task in each lane waits for. */
const STATES = [
  ["open", "A new or reset task"],
  ["spec_ready", "Has a spec"],
  ["ready_for_dev", "Has a plan"],
  ["in_progress", "The Builder works"],
  ["blocked", "The Builder waits for you"],
  ["ai_review", "QA can check the build"],
  ["human_review", "You check the build"],
  ["closed", "Closed"],
] as const satisfies readonly (readonly [LaneId, string])[];

const STATE_NODES = Object.fromEntries(
  STATES.map(([lane, text]): [string, NodeSpec] => [lane, { type: "state", data: { lane, text } }]),
);

const port = (id: string, side: Port["side"], at: number): Port => ({ id, side, at });
const SKIP_TO_BUILD = { label: "Task or bug: Builder starts", step: true, still: true };
const WITHOUT_QA = { label: "Approve Task without QA", step: true, still: true };

/**
 * The lanes of Spec, Plan, Build and the main moves between them, each with what causes it. Close
 * Task and Reset Task can move a task from any lane, so the diagram does not show them.
 */
export const laneMoves = defineDiagram({
  name: "lane-moves",
  label:
    "The lanes of Spec, Plan, Build and what moves a task between them. From Backlog, a saved spec moves the task to Spec Ready. From Spec Ready, a saved plan moves it to Ready for Dev. When the Builder starts, the task moves to In Progress. A task or a bug can go from Backlog to In Progress directly. From In Progress, the Build Blocked event moves the task to Blocked / Needs Input, and Build Resumed moves it back. Build Completed moves it to AI Review. In AI Review, a QA approval moves the task to Human Review, and a QA rejection moves it back to In Progress. In Human Review, Request Changes moves the task back to In Progress, and Approve Task moves it to Done. Approve Task in AI Review moves the task to Done without QA.",
  nodes: STATE_NODES,
  // Desktop: the planning lanes in the top row, the build lanes in the middle row, and the review
  // lanes in the bottom row, from right to left. The lines that send a task back go up.
  wide: {
    width: 860,
    height: 452,
    boxes: {
      open: { x: 0, y: 0, w: 135, h: 62 },
      spec_ready: { x: 225, y: 0, w: 135, h: 62 },
      ready_for_dev: { x: 450, y: 0, w: 135, h: 62 },
      in_progress: { x: 450, y: 170, w: 135, h: 62 },
      blocked: { x: 680, y: 170, w: 180, h: 62 },
      ai_review: { x: 450, y: 340, w: 135, h: 62 },
      human_review: { x: 225, y: 340, w: 135, h: 62 },
      closed: { x: 0, y: 340, w: 135, h: 62 },
    },
    ports: {
      in_progress: [
        port("skip", "left", 18),
        port("changes", "left", 44),
        port("block", "right", 18),
        port("resume", "right", 44),
        port("done", "bottom", 35),
        port("reject", "bottom", 100),
      ],
      blocked: [port("block", "left", 18), port("resume", "left", 44)],
      ai_review: [port("done", "top", 35), port("reject", "top", 100)],
    },
    edges: [
      ["open.r", "spec_ready.l", { label: "Spec saved" }],
      ["spec_ready.r", "ready_for_dev.l", { label: "Plan saved" }],
      ["ready_for_dev.b", "in_progress.t", { label: "Builder starts" }],
      ["open.b", "in_progress.skip", { ...SKIP_TO_BUILD, labelAt: { x: 230, y: 126 } }],
      ["in_progress.block", "blocked.block", { label: "Build Blocked" }],
      ["blocked.resume", "in_progress.resume", { label: "Build Resumed" }],
      [
        "in_progress.done",
        "ai_review.done",
        { label: "Build Completed", labelAt: { x: -54, y: 54 } },
      ],
      [
        "ai_review.reject",
        "in_progress.reject",
        { label: "QA rejects", kind: "reject", labelAt: { x: 40, y: -54 } },
      ],
      ["ai_review.l", "human_review.r", { label: "QA approves" }],
      ["human_review.l", "closed.r", { label: "Approve Task" }],
      [
        "human_review.t",
        "in_progress.changes",
        { label: "Request Changes", step: true, labelAt: { x: 82, y: -126 } },
      ],
      ["ai_review.b", "closed.b", { ...WITHOUT_QA, offset: 30 }],
    ],
  },
  // Phone: the lanes in one column, in board order. The lines that send a task back run on the
  // left, and the lines that skip lanes run on the right.
  narrow: {
    width: 360,
    height: 836,
    boxes: {
      open: { x: 85, y: 0, w: 170, h: 62 },
      spec_ready: { x: 85, y: 110, w: 170, h: 62 },
      ready_for_dev: { x: 85, y: 220, w: 170, h: 62 },
      in_progress: { x: 85, y: 330, w: 170, h: 62 },
      blocked: { x: 85, y: 440, w: 170, h: 62 },
      ai_review: { x: 85, y: 550, w: 170, h: 62 },
      human_review: { x: 85, y: 660, w: 170, h: 62 },
      closed: { x: 85, y: 770, w: 170, h: 62 },
    },
    ports: {
      in_progress: [
        port("changes", "left", 14),
        port("reject", "left", 44),
        port("skip", "right", 14),
        port("done", "right", 44),
        port("block", "bottom", 30),
        port("resume", "bottom", 150),
      ],
      blocked: [port("block", "top", 30), port("resume", "top", 150)],
      ai_review: [
        port("reject", "left", 20),
        port("done", "right", 18),
        port("approve", "right", 44),
      ],
    },
    edges: [
      ["open.b", "spec_ready.t", { label: "Spec saved" }],
      ["spec_ready.b", "ready_for_dev.t", { label: "Plan saved" }],
      ["ready_for_dev.b", "in_progress.t", { label: "Builder starts" }],
      ["open.r", "in_progress.skip", { ...SKIP_TO_BUILD, offset: 55 }],
      ["in_progress.block", "blocked.block", { label: "Build Blocked", labelAt: { x: 42, y: 12 } }],
      [
        "blocked.resume",
        "in_progress.resume",
        { label: "Build Resumed", labelAt: { x: -50, y: -14 } },
      ],
      ["in_progress.done", "ai_review.done", { label: "Build Completed", step: true, offset: 30 }],
      [
        "ai_review.reject",
        "in_progress.reject",
        { label: "QA rejects", kind: "reject", step: true, offset: 25 },
      ],
      ["ai_review.b", "human_review.t", { label: "QA approves" }],
      ["human_review.b", "closed.t", { label: "Approve Task" }],
      [
        "human_review.l",
        "in_progress.changes",
        { label: "Request Changes", step: true, offset: 50 },
      ],
      ["ai_review.approve", "closed.r", { ...WITHOUT_QA, offset: 55 }],
    ],
  },
});

/**
 * What Autopilot starts for a feature when every rule of Spec, Plan, Build is on. Each line is
 * the lane that sends the signal, and each box is the action of the rule and the session that it
 * starts. You start the first agent and approve the task.
 */
export const specPlanBuildAutopilot = defineDiagram({
  name: "spec-plan-build-autopilot",
  label:
    "A feature with every Autopilot rule of Spec, Plan, Build on. You start Spec. When the task reaches Spec Ready, Start Planner starts the Planner in a fresh session. At Ready for Dev, Start Builder starts the Builder in a fresh session. At AI Review, Start QA continues the last QA session, or starts a fresh one. If QA rejects the build, Fix QA Rejection continues the last Builder session, or starts a fresh one. At Human Review, Generate Pull Request forks the last Builder session to create the pull request. Then you approve the task.",
  nodes: {
    start: {
      type: "item",
      data: {
        title: "You start Spec",
        text: "Start Spec on a feature in Backlog",
        Icon: User,
        tone: "system",
      },
    },
    planner: {
      type: "item",
      data: { title: "Start Planner", text: "Planner, fresh session", Icon: ListChecks },
    },
    builder: {
      type: "item",
      data: { title: "Start Builder", text: "Builder, fresh session", Icon: Hammer },
    },
    qa: {
      type: "item",
      data: { title: "Start QA", text: "QA, its last session if any", Icon: ClipboardCheck },
    },
    pr: {
      type: "item",
      data: {
        title: "Generate Pull Request",
        text: "Fork of the last Builder session",
        Icon: GitPullRequest,
      },
    },
    approve: {
      type: "item",
      data: {
        title: "You approve",
        text: "Approve Task in Human Review",
        Icon: User,
        tone: "system",
      },
    },
  },
  // Desktop: the first three steps left to right, then the last three right to left.
  wide: {
    width: 860,
    height: 250,
    boxes: {
      start: { x: 0, y: 0, w: 210, h: 76 },
      planner: { x: 325, y: 0, w: 210, h: 76 },
      builder: { x: 650, y: 0, w: 210, h: 76 },
      qa: { x: 650, y: 174, w: 210, h: 76 },
      pr: { x: 325, y: 174, w: 210, h: 76 },
      approve: { x: 0, y: 174, w: 210, h: 76 },
    },
    ports: {
      builder: [port("down", "bottom", 60), port("up", "bottom", 160)],
      qa: [port("down", "top", 60), port("up", "top", 160)],
    },
    edges: [
      ["start.r", "planner.l", { label: "Spec Ready" }],
      ["planner.r", "builder.l", { label: "Ready for Dev" }],
      ["builder.down", "qa.down", { label: "AI Review" }],
      ["qa.up", "builder.up", { label: "Fix QA Rejection", kind: "reject" }],
      ["qa.l", "pr.r", { label: "Human Review" }],
      ["pr.l", "approve.r"],
    ],
  },
  // Phone: one column, with the rejection loop on the left.
  narrow: {
    width: 320,
    height: 652,
    boxes: {
      start: { x: 84, y: 0, w: 236, h: 76 },
      planner: { x: 84, y: 115, w: 236, h: 76 },
      builder: { x: 84, y: 230, w: 236, h: 76 },
      qa: { x: 84, y: 345, w: 236, h: 76 },
      pr: { x: 84, y: 460, w: 236, h: 76 },
      approve: { x: 84, y: 576, w: 236, h: 76 },
    },
    edges: [
      ["start.b", "planner.t", { label: "Spec Ready" }],
      ["planner.b", "builder.t", { label: "Ready for Dev" }],
      ["builder.b", "qa.t", { label: "AI Review" }],
      ["qa.l", "builder.l", { label: "Fix QA Rejection", kind: "reject", step: true, offset: 44 }],
      ["qa.b", "pr.t", { label: "Human Review" }],
      ["pr.b", "approve.t"],
    ],
  },
});

// Any workflow ----------------------------------------------------------------------------------

/** How a task moves through any workflow: an agent saves its work, and the workflow moves the task. */
export const taskFlow = chainDiagram({
  name: "task-flow",
  label:
    "How a task moves. You or an Autopilot rule start an agent of one role. The agent works in a task session with the tools of its role. It saves its work as a workflow artifact or sends a workflow event. The workflow then moves the task to the next lane, where the next step starts. When the work is done, you review and approve the task.",
  steps: [
    {
      id: "start",
      title: "Start an agent",
      text: "You or an Autopilot rule start a role.",
      Icon: Play,
    },
    {
      id: "session",
      title: "Task session",
      text: "The agent works with the tools of its role.",
      Icon: Bot,
      tone: "session",
    },
    {
      id: "save",
      title: "Saves its work",
      text: "A workflow artifact or a workflow event.",
      Icon: FileCheck,
    },
    { id: "move", title: "Next lane", text: "The workflow moves the task.", Icon: MoveRight },
    {
      id: "review",
      title: "You review",
      text: "Approve the task when the work is done.",
      Icon: UserCheck,
      tone: "result",
    },
  ],
  heights: { wide: 96, narrow: 64 },
  loop: { from: "move", to: "start", label: "Next step" },
});

/** How one Autopilot rule turns a task move into an agent session, for any workflow. */
export const autopilotRule = chainDiagram({
  name: "autopilot-rule",
  label:
    "How an Autopilot rule works. A workflow event moves a task to a new lane. The workflow names the move with a signal, such as Spec Ready. Your rule for that signal is Disabled, or one action that the workflow offers. When the rule has an action, the host starts its role in a fresh, reused, or forked session.",
  steps: [
    {
      id: "move",
      title: "Task moves",
      text: "A workflow event moves the task to a new lane.",
      Icon: MoveRight,
    },
    {
      id: "signal",
      title: "Workflow signal",
      text: "The workflow names the move, such as Spec Ready.",
      Icon: Radio,
    },
    {
      id: "rule",
      title: "Your rule",
      text: "Disabled, or one action that the workflow offers.",
      Icon: ToggleRight,
      tone: "system",
    },
    {
      id: "launch",
      title: "Agent session",
      text: "The host starts the role in a fresh, reused, or forked session.",
      Icon: Bot,
      tone: "result",
    },
  ],
  heights: { wide: 92, narrow: 72 },
});
