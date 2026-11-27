import {
  Bot,
  Columns3,
  FileText,
  ListChecks,
  MousePointerClick,
  MoveRight,
  PencilLine,
  SquareKanban,
  Tag,
  UserCog,
  Zap,
} from "lucide-react";
import { defineDiagram } from "../define";

/**
 * The parts of a custom workflow. A trigger starts a transition, and the transition moves the task
 * between the states of the board. A role runs a step, the step saves an artifact, and the save can
 * start a transition too.
 */
export const workflowParts = defineDiagram({
  name: "workflow-parts",
  label:
    "The parts of a workflow. A trigger starts a transition: a button that you select on the task, or an agent that moves the task. The transition moves the task from one state to another, and each state is a column of the board. A role, with its instructions, files, and tools, runs a step. The step saves an artifact, a document on the task, and the save can also start a transition.",
  nodes: {
    triggers: { type: "zone", data: { title: "Triggers", Icon: Zap } },
    button: {
      type: "item",
      data: { title: "Button", text: "You select it on the task.", Icon: MousePointerClick },
    },
    agent: {
      type: "item",
      data: { title: "Agent", text: "An agent moves the task.", Icon: Bot },
    },
    transition: {
      type: "item",
      data: {
        title: "Transition",
        text: "From one state to another.",
        Icon: MoveRight,
        tone: "system",
      },
    },
    states: {
      type: "item",
      data: { title: "State", text: "A column of the board.", Icon: Columns3 },
    },
    role: {
      type: "item",
      data: { title: "Role", text: "Instructions, files, and tools.", Icon: UserCog },
    },
    step: {
      type: "item",
      data: { title: "Step", text: "The work of one role.", Icon: ListChecks },
    },
    artifact: {
      type: "item",
      data: { title: "Artifact", text: "A document on the task.", Icon: FileText },
    },
  },
  // Desktop: the triggers, the transition, and the states in the top row. The role, the step, and
  // the artifact in the bottom row. The save of the artifact goes up into the transition.
  wide: {
    width: 860,
    height: 316,
    boxes: {
      triggers: { x: 0, y: 0, w: 220, h: 176 },
      button: { x: 10, y: 40, w: 200, h: 58, in: "triggers" },
      agent: { x: 10, y: 108, w: 200, h: 58, in: "triggers" },
      transition: { x: 320, y: 58, w: 210, h: 60 },
      states: { x: 650, y: 58, w: 210, h: 60 },
      role: { x: 0, y: 254, w: 220, h: 60 },
      step: { x: 320, y: 254, w: 210, h: 60 },
      artifact: { x: 650, y: 254, w: 210, h: 60 },
    },
    edges: [
      ["triggers.r", "transition.l", { label: "Starts" }],
      ["transition.r", "states.l", { label: "Moves the task" }],
      ["role.r", "step.l", { label: "Runs" }],
      ["step.r", "artifact.l", { label: "Saves" }],
      ["artifact.t", "transition.b", { label: "A save can start it", step: true }],
    ],
  },
  // Phone: one column. The save of the artifact goes up on the right into the transition.
  narrow: {
    width: 360,
    height: 776,
    boxes: {
      triggers: { x: 0, y: 0, w: 360, h: 172 },
      button: { x: 12, y: 40, w: 336, h: 56, in: "triggers" },
      agent: { x: 12, y: 106, w: 336, h: 56, in: "triggers" },
      transition: { x: 20, y: 232, w: 290, h: 60 },
      states: { x: 20, y: 352, w: 290, h: 60 },
      role: { x: 20, y: 472, w: 290, h: 60 },
      step: { x: 20, y: 592, w: 290, h: 60 },
      artifact: { x: 20, y: 712, w: 290, h: 60 },
    },
    edges: [
      ["triggers.b", "transition.t", { label: "Starts" }],
      ["transition.b", "states.t", { label: "Moves the task" }],
      ["role.b", "step.t", { label: "Runs" }],
      ["step.b", "artifact.t", { label: "Saves" }],
      ["artifact.r", "transition.r", { label: "A save can start it", step: true, offset: 26 }],
    ],
  },
});

/**
 * Publish and versions. Publish turns the draft into the next version, which never changes. New
 * tasks use the latest version, older tasks keep theirs, and Move tasks brings them to the latest.
 */
export const workflowVersions = defineDiagram({
  name: "workflow-versions",
  label:
    "Version 1 of a workflow never changes. Your edits make a draft, and Publish turns the draft into version 2, which never changes either. Tasks that started on version 1 keep it. New tasks start on version 2. Move tasks moves the tasks of version 1 to version 2, and they keep their work.",
  nodes: {
    older: {
      type: "item",
      data: { title: "Version 1", text: "It never changes.", Icon: Tag },
    },
    draft: {
      type: "item",
      data: { title: "Draft", text: "Your edits save by themselves.", Icon: PencilLine },
    },
    latest: {
      type: "item",
      data: {
        title: "Version 2",
        text: "The latest. It never changes.",
        Icon: Tag,
        tone: "system",
      },
    },
    oldTasks: {
      type: "item",
      data: { title: "Tasks on version 1", text: "They keep their version.", Icon: SquareKanban },
    },
    newTasks: {
      type: "item",
      data: { title: "Tasks on version 2", text: "New tasks start here.", Icon: SquareKanban },
    },
  },
  // Desktop: the versions from left to right in the top row, the tasks of each version under it.
  // Move tasks goes from the tasks of version 1 to the tasks of version 2.
  wide: {
    width: 860,
    height: 236,
    boxes: {
      older: { x: 0, y: 2, w: 220, h: 60 },
      draft: { x: 320, y: 2, w: 220, h: 60 },
      latest: { x: 640, y: 2, w: 220, h: 60 },
      oldTasks: { x: 0, y: 174, w: 220, h: 60 },
      newTasks: { x: 640, y: 174, w: 220, h: 60 },
    },
    edges: [
      ["older.r", "draft.l", { label: "Edit" }],
      ["draft.r", "latest.l", { label: "Publish" }],
      ["older.b", "oldTasks.t", { label: "Started on it" }],
      ["latest.b", "newTasks.t", { label: "New tasks" }],
      ["oldTasks.r", "newTasks.l", { label: "Move tasks" }],
    ],
  },
  // Phone: one column from version 1 to the tasks of version 2, then the tasks of version 1. The
  // tasks of version 1 hang from version 1 on the left, and Move tasks goes up on the right.
  narrow: {
    width: 370,
    height: 594,
    boxes: {
      older: { x: 45, y: 2, w: 280, h: 60 },
      draft: { x: 45, y: 122, w: 280, h: 60 },
      latest: { x: 45, y: 242, w: 280, h: 60 },
      newTasks: { x: 45, y: 362, w: 280, h: 60 },
      oldTasks: { x: 45, y: 532, w: 280, h: 60 },
    },
    edges: [
      ["older.b", "draft.t", { label: "Edit" }],
      ["draft.b", "latest.t", { label: "Publish" }],
      ["latest.b", "newTasks.t", { label: "New tasks" }],
      ["older.l", "oldTasks.l", { label: "Started on it", step: true, offset: 30 }],
      ["oldTasks.r", "newTasks.r", { label: "Move tasks", step: true, offset: 30 }],
    ],
  },
});
