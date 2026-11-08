import {
  Bot,
  CircleCheck,
  ClipboardCheck,
  Cpu,
  FileText,
  FolderGit2,
  Globe,
  Hammer,
  Layers,
  ListChecks,
  type LucideIcon,
  Package,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { LANE_LABELS } from "@/lib/lanes";
import { defineDiagram } from "../define";
import type { EdgeSpec, NodeData, NodeSpec, Port } from "../spec";

/** Ports along a side, at the given distances from its start, named `prefix1`, `prefix2`, … */
const ports = (prefix: string, side: Port["side"], places: number[]): Port[] =>
  places.map((at, index) => ({ id: `${prefix}${index + 1}`, side, at }));

const plus = { type: "sign", data: { sign: "+" } } as const;

// The system prompt -------------------------------------------------------------------------------

/**
 * How the system prompt is built: four sections joined in order, the placeholders replaced in every
 * section, and the result after the native system prompt of the harness.
 */
export const systemPrompt = defineDiagram({
  name: "system-prompt",
  label:
    "OpenDucktor joins four sections in this order: 1, the instructions of the role, such as Builder Instructions; 2, Workflow Guards; 3, Tool Protocol; 4, Task Context. Then it fills the placeholders in all four sections, for example task.title becomes Add dark mode and role becomes build. With every message, the harness gets its native system prompt, from OpenCode, Codex, or Claude Code, and then this OpenDucktor system prompt.",
  nodes: {
    // A zone holds the sections on a phone, and a bracket joins them on a wide screen.
    joinedZone: {
      type: "zone",
      data: { tone: "plain", title: "Joined in this order", Icon: Layers },
    },
    joined: { type: "brace", data: { label: "Joined in this order" } },
    role: {
      type: "item",
      data: { title: "1. Role instructions", text: "Such as Builder Instructions", Icon: Bot },
    },
    guards: {
      type: "item",
      data: { title: "2. Workflow Guards", text: "Same for all roles", Icon: ShieldCheck },
    },
    tools: {
      type: "item",
      data: {
        title: "3. Tool Protocol",
        text: "Same for all roles, with the tools of the role",
        Icon: Wrench,
      },
    },
    context: {
      type: "item",
      data: { title: "4. Task Context", text: "The fields of the task", Icon: FileText },
    },
    plus1: plus,
    plus2: plus,
    plus3: plus,
    placeholders: {
      type: "fill",
      data: {
        title: "Placeholders filled",
        text: "In all four sections, for example:",
        examples: [
          { placeholder: "task.title", value: "Add dark mode" },
          { placeholder: "role", value: "build" },
        ],
      },
    },
    final: {
      type: "zone",
      data: { tone: "host", title: "What the harness gets", text: "With every message", Icon: Cpu },
    },
    native: {
      type: "item",
      data: {
        title: "Native system prompt",
        text: "From OpenCode, Codex, or Claude Code",
        Icon: Cpu,
        tone: "native",
      },
    },
    plusNative: plus,
    odtPrompt: {
      type: "item",
      data: {
        title: "OpenDucktor system prompt",
        text: "Added after the native one",
        Icon: Layers,
        tone: "system",
      },
    },
  },
  wide: {
    width: 840,
    height: 480,
    boxes: {
      joinedZone: null,
      joined: { x: 0, y: 68, w: 840, h: 14 },
      role: { x: 0, y: 0, w: 192, h: 56 },
      guards: { x: 216, y: 0, w: 192, h: 56 },
      tools: { x: 432, y: 0, w: 192, h: 56 },
      context: { x: 648, y: 0, w: 192, h: 56 },
      plus1: { x: 192, y: 12, w: 24, h: 32 },
      plus2: { x: 408, y: 12, w: 24, h: 32 },
      plus3: { x: 624, y: 12, w: 24, h: 32 },
      placeholders: { x: 230, y: 128, w: 380, h: 108 },
      final: { x: 230, y: 284, w: 380, h: 196 },
      native: { x: 16, y: 46, w: 348, h: 56, in: "final" },
      plusNative: { x: 170, y: 102, w: 40, h: 22, in: "final" },
      odtPrompt: { x: 16, y: 124, w: 348, h: 56, in: "final" },
    },
    edges: [
      ["joined.b", "placeholders.t"],
      ["placeholders.r", "odtPrompt.r", { step: true, offset: 40 }],
    ],
  },
  narrow: {
    width: 340,
    height: 716,
    boxes: {
      joinedZone: { x: 0, y: 0, w: 340, h: 316 },
      joined: null,
      role: { x: 12, y: 44, w: 316, h: 52, in: "joinedZone" },
      guards: { x: 12, y: 116, w: 316, h: 52, in: "joinedZone" },
      tools: { x: 12, y: 188, w: 316, h: 52, in: "joinedZone" },
      context: { x: 12, y: 260, w: 316, h: 52, in: "joinedZone" },
      plus1: { x: 150, y: 96, w: 40, h: 20, in: "joinedZone" },
      plus2: { x: 150, y: 168, w: 40, h: 20, in: "joinedZone" },
      plus3: { x: 150, y: 240, w: 40, h: 20, in: "joinedZone" },
      placeholders: { x: 0, y: 364, w: 340, h: 108 },
      final: { x: 0, y: 520, w: 340, h: 196 },
      native: { x: 12, y: 46, w: 316, h: 56, in: "final" },
      plusNative: { x: 150, y: 102, w: 40, h: 22, in: "final" },
      odtPrompt: { x: 12, y: 124, w: 316, h: 56, in: "final" },
    },
    edges: [
      ["joinedZone.b", "placeholders.t"],
      ["placeholders.b", "final.t"],
    ],
  },
});

// The kickoff prompts -----------------------------------------------------------------------------

const ACTIONS = {
  spec: { lane: "open", action: "Start Spec", prompt: "Spec Kickoff" },
  planner: { lane: "spec_ready", action: "Start Planner", prompt: "Planner Kickoff" },
  build: { lane: "ready_for_dev", action: "Start Builder", prompt: "Builder Kickoff" },
  qa: { lane: "ai_review", action: "Request QA Review", prompt: "QA Kickoff" },
  rejected: {
    lane: "qa_rejected",
    laneLabel: "In Progress, QA Rejected",
    action: "Address QA Feedbacks",
    prompt: "Builder Kickoff After QA Rejection",
  },
  changes: {
    lane: "human_review",
    action: "Request Changes",
    prompt: "Builder Kickoff After Human Changes",
  },
  pullRequest: {
    lane: "human_review",
    action: "Approve Task › Ask Builder",
    prompt: "Pull Request Generation Kickoff",
  },
  conflict: {
    lane: "blocked",
    laneLabel: "Git conflict",
    action: "Resolve conflicts",
    prompt: "Builder Git Conflict Message",
  },
} satisfies Record<string, NodeData["action"]>;

type ActionId = keyof typeof ACTIONS;

const agent = (title: string, Icon: LucideIcon): NodeSpec => ({
  type: "item",
  data: { title, Icon, tone: "session" },
});

/** The order of the agents in the workflow. */
const AGENT_ORDER = [
  ["specAgent", "plannerAgent"],
  ["plannerAgent", "buildAgent"],
  ["buildAgent", "qaAgent"],
] as const;

const handoffs = (out: string, into: string): EdgeSpec<string>[] =>
  AGENT_ORDER.map(([from, to]) => [`${from}.${out}`, `${to}.${into}`, { still: true }]);

const COLUMN = 213;
const ROW = 140;
/** The actions on a phone, from top to bottom. */
const NARROW_ORDER: ActionId[] = [
  "spec",
  "planner",
  "build",
  "rejected",
  "changes",
  "pullRequest",
  "conflict",
  "qa",
];

/** The action that sends each kickoff prompt, where the action shows, and the agent that gets it. */
export const kickoffPrompts = defineDiagram({
  name: "kickoff-prompts",
  label: `Each action sends one kickoff prompt to one agent. ${Object.values(ACTIONS)
    .map(
      (data) =>
        `${data.action}, in ${"laneLabel" in data ? data.laneLabel : LANE_LABELS[data.lane]}, sends ${data.prompt}.`,
    )
    .join(" ")} The dashed lines show the order of the agents: Spec, Planner, Builder, then QA.`,
  nodes: Object.fromEntries([
    ...Object.entries(ACTIONS).map(([id, data]): [string, NodeSpec] => [
      id,
      { type: "action", data },
    ]),
    ["specAgent", agent("Spec agent", FileText)],
    ["plannerAgent", agent("Planner", ListChecks)],
    ["buildAgent", agent("Builder", Hammer)],
    ["qaAgent", agent("QA agent", ClipboardCheck)],
  ]),

  // Desktop: the first actions over their agents, and the actions of the Builder under it.
  wide: {
    width: 840,
    height: 432,
    boxes: {
      spec: { x: 0, y: 0, w: 200, h: 112 },
      planner: { x: COLUMN, y: 0, w: 200, h: 112 },
      build: { x: COLUMN * 2, y: 0, w: 200, h: 112 },
      qa: { x: COLUMN * 3, y: 0, w: 200, h: 112 },
      specAgent: { x: 22, y: 160, w: 155, h: 56 },
      plannerAgent: { x: COLUMN + 22, y: 160, w: 155, h: 56 },
      buildAgent: { x: COLUMN * 2 + 22, y: 160, w: 155, h: 56 },
      qaAgent: { x: COLUMN * 3 + 22, y: 160, w: 155, h: 56 },
      conflict: { x: 0, y: 288, w: 200, h: 128 },
      changes: { x: COLUMN, y: 288, w: 200, h: 128 },
      pullRequest: { x: COLUMN * 2, y: 288, w: 200, h: 128 },
      rejected: { x: COLUMN * 3, y: 288, w: 200, h: 128 },
    },
    ports: { buildAgent: ports("b", "bottom", [20, 58, 97, 135]) },
    edges: [
      ["spec.b", "specAgent.t"],
      ["planner.b", "plannerAgent.t"],
      ["build.b", "buildAgent.t"],
      ["qa.b", "qaAgent.t"],
      ["conflict.t", "buildAgent.b1", { step: true }],
      ["changes.t", "buildAgent.b2", { step: true }],
      ["pullRequest.t", "buildAgent.b3", { step: true }],
      ["rejected.t", "buildAgent.b4", { step: true }],
      ...handoffs("r", "l"),
    ],
  },
  // Phone: the actions in a column, each with a line to its agent on the right.
  narrow: {
    width: 340,
    height: ROW * NARROW_ORDER.length + 4,
    boxes: {
      ...Object.fromEntries(
        NARROW_ORDER.map((id, index) => [id, { x: 0, y: index * ROW, w: 200, h: 128 }]),
      ),
      specAgent: { x: 236, y: 36, w: 104, h: 56 },
      plannerAgent: { x: 236, y: ROW + 36, w: 104, h: 56 },
      buildAgent: { x: 236, y: ROW * 2, w: 104, h: ROW * 4 + 128 },
      qaAgent: { x: 236, y: ROW * 7 + 36, w: 104, h: 56 },
    },
    data: { specAgent: { title: "Spec" }, qaAgent: { title: "QA" } },
    edges: [
      ["spec.r", "specAgent.l"],
      ["planner.r", "plannerAgent.l"],
      ["build.r", "buildAgent.l", { align: "source" }],
      ["rejected.r", "buildAgent.l", { align: "source" }],
      ["changes.r", "buildAgent.l", { align: "source" }],
      ["pullRequest.r", "buildAgent.l", { align: "source" }],
      ["conflict.r", "buildAgent.l", { align: "source" }],
      ["qa.r", "qaAgent.l"],
      ...handoffs("b", "t"),
    ],
  },
});

// The prompt sources ------------------------------------------------------------------------------

const OFF = { label: "Off", still: true };
const ON = { label: "On", step: true };

/**
 * The final text of a prompt: the base text from a repository override, a global override, or the
 * built-in prompt, then the global append, then the repository append.
 */
export const promptSources = defineDiagram({
  name: "prompt-sources",
  label:
    "For each prompt, OpenDucktor first finds the base text. If the repository override is on, it is the base text. If it is off, OpenDucktor checks the global override. If that is off too, the base text is the built-in prompt. The final text is the base text, then the global append from System prompts, then the repository append from Repository prompts. An append that is off or empty adds nothing.",
  nodes: {
    repo: {
      type: "item",
      data: { title: "Repository override", text: "Repository prompts", Icon: FolderGit2 },
    },
    global: {
      type: "item",
      data: { title: "Global override", text: "System prompts", Icon: Globe },
    },
    builtin: {
      type: "item",
      data: { title: "Built-in prompt", text: "In OpenDucktor", Icon: Package },
    },
    final: {
      type: "zone",
      data: { tone: "plain", title: "Final text, in this order", Icon: CircleCheck },
    },
    base: {
      type: "item",
      data: { title: "Base text", text: "The first that is on", Icon: FileText },
    },
    plusGlobal: plus,
    globalAppend: {
      type: "item",
      data: { title: "Global append", text: "System prompts", Icon: Globe },
    },
    plusRepo: plus,
    repoAppend: {
      type: "item",
      data: { title: "Repository append", text: "Repository prompts", Icon: FolderGit2 },
    },
  },
  // Desktop: the base text sources on the left, and the final text on the right.
  wide: {
    width: 840,
    height: 320,
    boxes: {
      repo: { x: 0, y: 0, w: 196, h: 64 },
      global: { x: 0, y: 128, w: 196, h: 64 },
      builtin: { x: 0, y: 256, w: 196, h: 64 },
      final: { x: 256, y: 80, w: 584, h: 128 },
      base: { x: 8, y: 48, w: 176, h: 64, in: "final" },
      plusGlobal: { x: 184, y: 64, w: 20, h: 32, in: "final" },
      globalAppend: { x: 204, y: 48, w: 176, h: 64, in: "final" },
      plusRepo: { x: 380, y: 64, w: 20, h: 32, in: "final" },
      repoAppend: { x: 400, y: 48, w: 176, h: 64, in: "final" },
    },
    ports: { base: ports("l", "left", [12, 52]) },
    edges: [
      ["repo.b", "global.t", OFF],
      ["global.b", "builtin.t", OFF],
      ["repo.r", "base.l1", ON],
      ["global.r", "base.l", { label: "On", align: "source", labelAt: { x: 17, y: 0 } }],
      ["builtin.r", "base.l2", { step: true }],
    ],
  },
  // Phone: the sources above the final text.
  narrow: {
    width: 340,
    height: 640,
    boxes: {
      repo: { x: 0, y: 0, w: 200, h: 64 },
      global: { x: 0, y: 128, w: 200, h: 64 },
      builtin: { x: 0, y: 256, w: 200, h: 64 },
      final: { x: 0, y: 360, w: 340, h: 280 },
      base: { x: 12, y: 44, w: 316, h: 56, in: "final" },
      plusGlobal: { x: 150, y: 100, w: 40, h: 28, in: "final" },
      globalAppend: { x: 12, y: 128, w: 316, h: 56, in: "final" },
      plusRepo: { x: 150, y: 184, w: 40, h: 28, in: "final" },
      repoAppend: { x: 12, y: 212, w: 316, h: 56, in: "final" },
    },
    ports: { base: ports("t", "top", [228, 268, 308]) },
    edges: [
      ["repo.b", "global.t", OFF],
      ["global.b", "builtin.t", OFF],
      ["repo.r", "base.t3", ON],
      ["global.r", "base.t2", ON],
      ["builtin.r", "base.t1", { step: true }],
    ],
  },
});
