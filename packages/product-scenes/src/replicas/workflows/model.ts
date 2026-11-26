// The data of the workflow editor replicas: the states and the transition lines of the canvas in
// flow coordinates, as the canvas of packages/frontend/src/features/workflows/editor draws them.
// A scene gives the positions, the line paths, and the label boxes that the product layout and
// router give, and src/copied-workflow-editor.test.ts compares them with the product.
import type { Point } from "../../motion/offset";

/** WorkflowTone of packages/contracts: the colour of a state. */
export type StateTone =
  | "neutral"
  | "pending"
  | "info"
  | "warning"
  | "destructive"
  | "review"
  | "approval"
  | "success";

/** The tones in the order of workflowToneSchema, which the Colour swatches of a state show. */
export const STATE_TONES = [
  "neutral",
  "pending",
  "info",
  "warning",
  "destructive",
  "review",
  "approval",
  "success",
] as const satisfies readonly StateTone[];

/** The box of a line label, from the top left corner, in flow coordinates. */
export type Box = Point & { readonly width: number; readonly height: number };

/**
 * The viewport of the canvas: the pan in design pixels and the zoom. The editor centers a workflow
 * that fits, so `x` counts from the middle of the canvas, and the content stays centered in a
 * canvas of another width. `y` counts from the top.
 */
export type Viewport = Point & { readonly zoom: number };

/** A state box of the canvas and a row of the States list. */
export type CanvasState = {
  readonly id: string;
  readonly label: string;
  readonly tone: StateTone;
};

/** The route of one transition line: its SVG path and its label box. */
export type LineRoute = { readonly path: string; readonly label: Box };

/** A transition line: what its label says and how it looks when the frame starts. */
export type CanvasLine = {
  readonly id: string;
  /** The label text, which the label of a named transition shows. */
  readonly text: string;
  /** A button or an agent sends the transition. Else the line is dotted. */
  readonly triggered: boolean;
};

/** How a box or a line shows against the selection, as CanvasEmphasis of state-node.tsx. */
export type Emphasis = "selected" | "related" | "dimmed" | "normal";

/** The worst problem of an element. Errors block publication, warnings do not. */
type ProblemLevel = "error" | "warning";

/** The readiness of the draft from readiness.ts: the worst problem, the title, and the detail. */
export type Readiness = {
  readonly level: ProblemLevel | null;
  readonly title: string;
  readonly detail: string | null;
};

/**
 * One frame of the canvas: the box positions, the line routes, and the box around the boxes and
 * the lines with their labels, which a fit of the viewport shows.
 */
export type CanvasFrame = {
  readonly positions: Readonly<Record<string, Point>>;
  readonly routes: Readonly<Record<string, LineRoute>>;
  readonly content: Box;
};

/** The ids of the arrowheads: the line colour, and the selection colour of an emphasized line. */
export const ARROW = { normal: "wfe-arrow", emphasized: "wfe-arrow-selected" } as const;

/** The size of a state box: STATE_BOX_WIDTH and STATE_BOX_HEIGHT of canvas-layout.ts. */
export const STATE_BOX = { width: 240, height: 68 } as const;

/** The icon of a state box: the first column takes new tasks, the last one closes them. */
export type StateIcon = "open" | "work" | "closed";

/** The icon of a state, as stateIcon of state-node.tsx picks it from the state ID. */
export function stateIcon(id: string): StateIcon {
  if (id === "open") return "open";
  if (id === "closed") return "closed";
  return "work";
}
