// The sample data of the workflow-editor scene: the custom workflow Quick fix of the Fieldnotes
// workspace. Version 1 moves a bug from Backlog to Fixing with the Start fixing button, and from
// Fixing to Done with Mark fixed. The visitor adds the state Test, draws a transition from Fixing
// to Test, gives it a board button, and publishes version 2. The positions, the line routes, and
// the content boxes are those of the product: autoLayout and placeNewState of canvas-layout.ts,
// and routeLinks of edge-routes.ts. The words of the transitions and the problems come from the
// workflow check. src/copied-workflow-editor.test.ts builds the same workflow with the product
// and compares each value.
import type { MovableTask } from "../../replicas/workflows/WorkflowDialogs";
import type { InspectedEvent } from "../../replicas/workflows/EventInspector";
import type { Point } from "../../motion/offset";
import { PROBLEMS_TEXT, toCheck } from "../../replicas/workflows/text";
import type {
  CanvasFrame,
  CanvasLine,
  CanvasState,
  LineRoute,
  Readiness,
} from "../../replicas/workflows/model";
import type { OutlineTransition } from "../../replicas/workflows/OutlinePanel";
import type { CanvasSize, RevealTarget } from "../../replicas/workflows/viewport";
import { TASKS } from "../../sample/tasks";
import { taskId, WORKSPACE } from "../../sample/workspace";

/** The readiness line after each step, as readiness.ts writes it. */
export const READINESS = {
  published: { level: null, title: PROBLEMS_TEXT.published, detail: PROBLEMS_TEXT.nextChange },
  warning: { level: "warning", title: toCheck(1), detail: null },
  ready: { level: null, title: PROBLEMS_TEXT.ready, detail: null },
} as const satisfies Record<string, Readiness>;

/** The name of the workflow. */
export const WORKFLOW = "Quick fix";

/** The published version at the start. The publication makes the next one. */
export const VERSION = 1;

/** The states, with the tones that addState gives the new states in turn. */
export const STATES = {
  open: { id: "open", label: "Backlog", tone: "neutral" },
  fixing: { id: "fixing", label: "Fixing", tone: "pending" },
  test: { id: "test", label: "Test", tone: "info" },
  closed: { id: "closed", label: "Done", tone: "success" },
} as const satisfies Record<string, CanvasState>;

/** The states in the order of the definition: addState puts the new state before Done. */
export const STATE_LIST = [STATES.open, STATES.fixing, STATES.test, STATES.closed] as const;

/** The name that the visitor types for the new state. */
export const NEW_STATE = STATES.test;

/**
 * The transitions. A board button sends each one at the end. addEvent names the new transition
 * after its target.
 */
export const LINES = [
  { id: "start_fixing", text: "Start fixing", triggered: true },
  { id: "mark_fixed", text: "Mark fixed", triggered: true },
  { id: "move_to_test", text: "Move to Test", triggered: true },
] as const satisfies readonly CanvasLine[];

type LineId = (typeof LINES)[number]["id"];

/** The transition that the visitor draws. */
export const NEW_LINE: LineId = "move_to_test";

/** The rows of the Transitions section: the name of each transition and its route. */
export const OUTLINE_TRANSITIONS = [
  { id: "start_fixing", name: "Start fixing", route: "Backlog → Fixing", triggered: true },
  { id: "mark_fixed", name: "Mark fixed", route: "Fixing → Done", triggered: true },
  { id: "move_to_test", name: "Move to Test", route: "Fixing → Test", triggered: true },
] as const satisfies readonly OutlineTransition[];

/** The board buttons of version 1, and the button that the visitor adds. */
export const BUTTONS = { before: 2, after: 3 } as const;

/** The workflow is for bugs only, so its Issue types section counts one. */
export const ISSUE_TYPES = 1;

/**
 * The size of the canvas in each layout of the view, with the details closed and open: the window
 * of 1440 by 780 with the collapsed sidebar, the phone stage of 470 by 900 with the details under
 * the canvas, and the frame of the app tour, 1300 wide in TOUR_FRAME_ASPECT, without the sidebar.
 */
export const CANVAS_SIZE = {
  wide: { width: 1045, height: 685 },
  narrow: { width: 644, height: 685 },
  phone: { width: 468, height: 748 },
  phoneNarrow: { width: 468, height: 468 },
  framed: { width: 1027, height: 521 },
} as const;

/**
 * The design pixels of the canvas that the toast of the publication covers: at the right of the
 * window, and at the bottom of a phone stage, where the toast takes the width of the canvas.
 */
export const TOAST_ROOM = {
  wide: { width: 96, height: 0 },
  phone: { width: 0, height: 106 },
} as const satisfies Record<string, CanvasSize>;

/**
 * What the editor shows of each new selection, as revealTarget of reveal-target.ts gives it: the
 * new state alone, and the label of the new transition with the line and its two states.
 */
export const REVEAL = {
  state: {
    selection: { x: 0, y: 376, width: 240, height: 68 },
    neighbours: { x: 0, y: 376, width: 240, height: 68 },
  },
  line: {
    selection: { x: 126, y: 303, width: 167, height: 26 },
    neighbours: { x: 0, y: 188, width: 293, height: 256 },
  },
} as const satisfies Record<string, RevealTarget>;

const START_FIXING: LineRoute = {
  path: "M 120 68 L 120 188",
  label: { x: 126, y: 115, width: 147, height: 26 },
};

/** Mark fixed around the box of Test, with both lines on the bottom of Fixing. */
const MARK_FIXED_AROUND: LineRoute = {
  path: "M 80 256 L 80 268 Q 80 276 72 276 L -24 276 Q -32 276 -32 284 L -32 488 Q -32 496 -24 496 L 112 496 Q 120 496 120 504 L 120 516",
  label: { x: -170, y: 373, width: 132, height: 26 },
};

/** The line of the new transition before and after its board button. */
const MOVE_TO_TEST = {
  untriggered: { path: "M 120 256 L 120 376", label: { x: 126, y: 303, width: 167, height: 26 } },
  triggered: { path: "M 120 256 L 120 376", label: { x: 126, y: 303, width: 147, height: 26 } },
} as const satisfies Record<string, LineRoute>;

/** The positions of the boxes in this session: Test takes the place of Done, one row up. */
const SESSION_POSITIONS = {
  open: { x: 0, y: 0 },
  fixing: { x: 0, y: 188 },
  test: { x: 0, y: 376 },
  closed: { x: 0, y: 516 },
} as const satisfies Record<string, Point>;

/** The content of the session frames, with the line of Mark fixed around Test. */
const SESSION_CONTENT = { x: -170, y: 0, width: 443, height: 584 } as const;

/**
 * The frames of the canvas. `published` is version 1 in its opening viewport. `added` has the new
 * state. `connected` has the new transition without a trigger, and `triggered` with its board
 * button. `republished` is version 2 after the editor opens it again, in auto layout.
 */
export const FRAMES = {
  published: {
    positions: { open: { x: 0, y: 0 }, fixing: { x: 0, y: 188 }, closed: { x: 0, y: 376 } },
    routes: {
      start_fixing: START_FIXING,
      mark_fixed: {
        path: "M 120 256 L 120 376",
        label: { x: 126, y: 303, width: 132, height: 26 },
      },
    },
    content: { x: 0, y: 0, width: 273, height: 444 },
  },
  added: {
    positions: SESSION_POSITIONS,
    content: SESSION_CONTENT,
    routes: {
      start_fixing: START_FIXING,
      mark_fixed: {
        path: "M 120 256 L 120 268 Q 120 276 112 276 L -24 276 Q -32 276 -32 284 L -32 488 Q -32 496 -24 496 L 112 496 Q 120 496 120 504 L 120 516",
        label: { x: -170, y: 373, width: 132, height: 26 },
      },
    },
  },
  connected: {
    positions: SESSION_POSITIONS,
    content: { ...SESSION_CONTENT, width: 463 },
    routes: {
      start_fixing: START_FIXING,
      mark_fixed: MARK_FIXED_AROUND,
      move_to_test: MOVE_TO_TEST.untriggered,
    },
  },
  triggered: {
    positions: SESSION_POSITIONS,
    content: SESSION_CONTENT,
    routes: {
      start_fixing: START_FIXING,
      mark_fixed: MARK_FIXED_AROUND,
      move_to_test: MOVE_TO_TEST.triggered,
    },
  },
  republished: {
    positions: {
      open: { x: 0, y: 0 },
      fixing: { x: 0, y: 188 },
      test: { x: 0, y: 424 },
      closed: { x: 0, y: 612 },
    },
    routes: {
      start_fixing: START_FIXING,
      mark_fixed: {
        path: "M 80 256 L 80 268 Q 80 276 72 276 L -24 276 Q -32 276 -32 284 L -32 584 Q -32 592 -24 592 L 112 592 Q 120 592 120 600 L 120 612",
        label: { x: -170, y: 421, width: 132, height: 26 },
      },
      move_to_test: {
        path: "M 120 256 L 120 424",
        label: { x: 126, y: 327, width: 147, height: 26 },
      },
    },
    content: { x: -170, y: 0, width: 443, height: 680 },
  },
} as const satisfies Record<string, CanvasFrame>;

/** The ends of the line of the new transition, where its grips show while it is selected. */
export const NEW_LINE_ENDS: readonly [Point, Point] = [
  { x: 120, y: 256 },
  { x: 120, y: 376 },
];

/** The warning of the new state until a transition reaches it. */
export const STATE_PROBLEM =
  'Tasks cannot reach "Test" from "Backlog". Draw a transition to it, or delete the state.';

/** The new transition in its details. */
export const NEW_EVENT: InspectedEvent = {
  name: "Move to Test",
  from: STATES.fixing.id,
  to: STATES.test,
  summary: {
    untriggered: "Nothing starts this transition yet. It moves the task to Test.",
    triggered: "The Move to Test button moves the task to Test.",
  },
  problem:
    'Nothing triggers the transition from "Fixing" to "Test", so it never moves a task. Add a board button for it, or let agents send it.',
};

/** The bug on version 1 in Fixing, which the publication offers to move to version 2. */
export const MOVABLE_TASKS: readonly MovableTask[] = [
  { title: TASKS.h4t8.title, id: taskId("h4t8"), state: STATES.fixing.label, version: VERSION },
];

/** The repository of the movable task. */
export const REPOSITORY = WORKSPACE;
