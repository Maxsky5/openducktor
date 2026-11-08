import { type Edge, type Node, Position } from "@xyflow/react";
import type { LucideIcon } from "lucide-react";
import type { LaneId } from "@/lib/lanes";

/**
 * The types of the diagram specs: what each diagram shows, and where. `defineDiagram` of
 * `define.ts` turns a spec into the nodes and edges of React Flow for a wide and a phone layout,
 * and `chainDiagram` of `chain.ts` builds the spec of a chain of steps.
 */

/** A box from the top left corner of the canvas, or of the node named in `in`. */
export type Box = { x: number; y: number; w: number; h: number; in?: string };
export type Side = "top" | "right" | "bottom" | "left";
/** A connection point on a side of a node, at `at` pixels from the start of the side. */
export type Port = { id: string; side: Side; at: number };

/** The tones of an item node. `nodes.css` gives each one its look. */
export const ITEM_TONES = ["system", "session", "result", "native", "host"] as const;
/** The tones of a zone node. A zone without a tone is a neutral group. */
export const ZONE_TONES = ["host", "remote", "plain"] as const;

/** A box with an icon, a title, and an optional line of text. */
export type ItemData = {
  title: string;
  text?: string;
  /** Exact values under the text, such as a path, each with a short label. */
  values?: { label: string; value: string }[];
  Icon: LucideIcon;
  tone?: (typeof ITEM_TONES)[number];
};

/** A labeled area that holds other nodes. */
export type ZoneData = {
  title: string;
  text?: string;
  Icon: LucideIcon;
  tone?: (typeof ZONE_TONES)[number];
};

/** The data of each node type. `nodes.tsx` draws each type. */
export type NodeData = {
  item: ItemData;
  zone: ZoneData;
  /** A numbered step of a workflow, with its role and its job. */
  step: { number: number; role: string; you?: boolean; does: string };
  /** A document that a step saves on the task. */
  artifact: { name: string; Icon: LucideIcon };
  /** A board lane, as a pill in the middle of its box. */
  lane: { lane: LaneId };
  /** A board lane as a card, with what a task in the lane waits for. */
  state: { lane: LaneId; text: string };
  /** An action of the app, the lane where it shows, and the prompt that it sends. */
  action: { lane: LaneId; laneLabel?: string; action: string; prompt: string };
  /** A sign between two nodes, such as the plus of a concatenation. */
  sign: { sign: string };
  /** The step that replaces placeholders, with examples and their values. */
  fill: { title: string; text: string; examples: { placeholder: string; value: string }[] };
  /** A bracket under a row of nodes, with the name of the group. */
  brace: { label: string };
};

export type NodeKind = keyof NodeData;
export type NodeSpec = { [K in NodeKind]: { type: K; data: NodeData[K] } }[NodeKind];

/** A port that an edge uses, with the handle types that the node needs for it. */
export type UsedPort = Port | (Omit<Port, "at"> & { at?: undefined });
export type PortHandle = UsedPort & { types: ("source" | "target")[] };
/** The data of a node of a layout: the data of its spec, and the ports that its edges use. */
export type PortedData = NodeData[NodeKind] & { ports: PortHandle[] };

export type EdgeOptions = {
  label?: string;
  /** A class suffix, such as `reject` for `docs-flow-edge-reject`. */
  kind?: "remote" | "reject";
  /** Turns at right angles instead of a straight line. */
  step?: boolean;
  /** A line without the flow animation. */
  still?: boolean;
  /** For a line with turns, the distance from a node to its first turn. */
  offset?: number;
  /**
   * The center of the label from the start of the line. Use it only when the default place does
   * not fit: the middle of a line, or the middle of the outer part of a line that turns back.
   */
  labelAt?: { x: number; y: number };
  /**
   * Places the port of the other end in line with the middle of this end's node, so the line is
   * straight. The other end names only a side, such as `host.l`.
   */
  align?: "source" | "target";
};

/**
 * An arrow from a port of a node to a port of another node, such as `["a.r", "b.l"]`. The side
 * ports are `t`, `r`, `b`, and `l`, at the middle of each side. Other ports come from the layout.
 */
export type EdgeSpec<Id extends string> = readonly [
  source: `${Id}.${string}`,
  target: `${Id}.${string}`,
  options?: EdgeOptions,
];

export type LayoutSpec<N extends Record<string, NodeSpec>> = {
  width: number;
  height: number;
  /** The box of each node. `null` leaves the node out of this layout. */
  boxes: { [K in keyof N]: Box | null };
  /** The ports of the nodes, other than the side ports and the aligned ports. */
  ports?: { [K in keyof N]?: Port[] };
  /** Data that this layout changes, such as a shorter title on a phone. */
  data?: { [K in keyof N]?: Partial<N[K]["data"]> };
  edges: EdgeSpec<keyof N & string>[];
};

export type DiagramSpec<N extends Record<string, NodeSpec>> = {
  /** The name of the diagram in errors and in the catalog. */
  name: string;
  /** The full text of the diagram, for readers who cannot see it. */
  label: string;
  /** The nodes in drawing order. A node comes after the node that holds it. */
  nodes: N;
  wide: LayoutSpec<N>;
  narrow: LayoutSpec<N>;
};

/** A label of an edge, at its center, in the coordinates of the layout. */
export type EdgeLabel = {
  id: string;
  text: string;
  x: number;
  y: number;
  /** The label reads from top to bottom, along a vertical part of the line. */
  vertical: boolean;
  kind?: EdgeOptions["kind"];
};

export type FlowLayout = {
  width: number;
  height: number;
  nodes: Node<PortedData>[];
  edges: Edge[];
  /** The edge labels. The page draws them in HTML, so the server HTML has them. */
  labels: EdgeLabel[];
};
export type Diagram = { name: string; label: string; wide: FlowLayout; narrow: FlowLayout };

export const POSITIONS = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
} as const satisfies Record<Side, Position>;
