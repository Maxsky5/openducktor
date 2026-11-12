// The resolver of the diagram specs. `defineDiagram` places the ports, keeps only the handles that
// an edge uses, and throws on a spec that React Flow would draw wrong without a word.
import {
  type Edge,
  getSmoothStepPath,
  MarkerType,
  type Node,
  type SmoothStepPathOptions,
} from "@xyflow/react";
import {
  type Box,
  type Diagram,
  type DiagramSpec,
  type EdgeLabel,
  type EdgeOptions,
  type FlowLayout,
  ITEM_TONES,
  type NodeKind,
  type NodeSpec,
  type PortedData,
  type PortHandle,
  POSITIONS,
  type Side,
  type UsedPort,
  ZONE_TONES,
} from "./spec";

/** The side of a side port: `t`, `r`, `b`, or `l`, at the middle of the side. */
function sidePort(portId: string): Side | undefined {
  switch (portId) {
    case "t":
      return "top";
    case "r":
      return "right";
    case "b":
      return "bottom";
    case "l":
      return "left";
    default:
      return undefined;
  }
}

const TONES = new Map<NodeKind, readonly string[]>([
  ["item", ITEM_TONES],
  ["zone", ZONE_TONES],
]);

type Point = { x: number; y: number };

const vertical = (side: Side) => side === "left" || side === "right";

/** The place of a port in its node: on its side, at `at` or at the middle. */
function portPoint({ side, at }: UsedPort, box: Box): Point {
  switch (side) {
    case "top":
      return { x: at ?? box.w / 2, y: 0 };
    case "bottom":
      return { x: at ?? box.w / 2, y: box.h };
    case "left":
      return { x: 0, y: at ?? box.h / 2 };
    case "right":
      return { x: box.w, y: at ?? box.h / 2 };
  }
}

const inside = (box: Box, width: number, height: number) =>
  box.x >= 0 && box.y >= 0 && box.x + box.w <= width && box.y + box.h <= height;

type Placed = {
  box: Box;
  /** The box from the top left corner of the canvas. */
  absolute: Box;
  ports: Map<string, PortHandle>;
};

function resolveLayout<N extends Record<string, NodeSpec>>(
  spec: DiagramSpec<N>,
  which: "wide" | "narrow",
): FlowLayout {
  const layout = spec[which];
  const problem = (text: string) =>
    new Error(`The ${which} layout of the diagram "${spec.name}" ${text}`);
  const placed = new Map<string, Placed>();
  const nodes: Node<PortedData>[] = [];

  for (const [id, node] of Object.entries(spec.nodes)) {
    const box = layout.boxes[id];
    if (box === undefined)
      throw problem(`has no box for the node "${id}". Give it a box, or null.`);
    if (!box) continue;
    const data = { ...node.data, ...layout.data?.[id] };
    const tones = TONES.get(node.type) ?? [];
    if ("tone" in data && data.tone !== undefined && !tones.includes(data.tone)) {
      throw problem(
        `gives the node "${id}" the tone "${data.tone}". Use one of: ${tones.join(", ")}.`,
      );
    }
    const parent = box.in === undefined ? undefined : placed.get(box.in);
    if (box.in !== undefined && !parent) {
      throw problem(`puts the node "${id}" in "${box.in}", which is not a node before it.`);
    }
    const bounds = parent ? parent.box : { w: layout.width, h: layout.height };
    if (!inside(box, bounds.w, bounds.h)) {
      const container = parent ? `the node "${box.in}"` : "the canvas";
      throw problem(`puts the node "${id}" outside ${container} (${bounds.w}x${bounds.h}).`);
    }
    const absolute = parent
      ? { ...box, x: parent.absolute.x + box.x, y: parent.absolute.y + box.y }
      : box;
    placed.set(id, { box, absolute, ports: new Map() });
    const flowNode: Node<PortedData> = {
      id,
      type: node.type,
      position: { x: box.x, y: box.y },
      width: box.w,
      height: box.h,
      data: { ...data, ports: [] },
    };
    if (box.in !== undefined) flowNode.parentId = box.in;
    nodes.push(flowNode);
  }

  const find = (id: string): Placed => {
    const found = placed.get(id);
    if (!found) throw problem(`has an edge to the node "${id}", which is not in this layout.`);
    return found;
  };

  /** The port of an end. An aligned port sits in line with the middle of the facing node. */
  const endPort = (id: string, portId: string, facing: string | undefined): UsedPort => {
    const side = sidePort(portId);
    if (facing === undefined) {
      if (side) return { id: portId, side };
      const port = layout.ports?.[id]?.find((candidate) => candidate.id === portId);
      if (!port) throw problem(`has no port "${portId}" on the node "${id}".`);
      return port;
    }
    if (!side) throw problem(`aligns the port "${portId}" of "${id}", but only a side can align.`);
    const own = find(id).absolute;
    const other = find(facing).absolute;
    const across = vertical(side);
    const at = across ? other.y + other.h / 2 - own.y : other.x + other.w / 2 - own.x;
    if (at <= 0 || at >= (across ? own.h : own.w)) {
      throw problem(`cannot align a port on the ${side} of "${id}" with "${facing}".`);
    }
    return { id: `${portId}-${facing}`, side, at };
  };

  const use = (id: string, port: UsedPort, type: "source" | "target") => {
    const { ports } = find(id);
    const known = ports.get(port.id) ?? { ...port, types: [] };
    if (!known.types.includes(type)) known.types.push(type);
    ports.set(port.id, known);
  };

  /** The place of a port in the canvas. */
  const point = (id: string, port: UsedPort): Point => {
    const { box, absolute } = find(id);
    const inNode = portPoint(port, box);
    return { x: absolute.x + inNode.x, y: absolute.y + inNode.y };
  };

  const ids = new Set<string>();
  const labels: EdgeLabel[] = [];
  const edges = layout.edges.map(([sourceEnd, targetEnd, options = {}]) => {
    const [source = "", sourcePortId = ""] = sourceEnd.split(".");
    const [target = "", targetPortId = ""] = targetEnd.split(".");
    find(source);
    find(target);
    const sourceFacing = options.align === "target" ? target : undefined;
    const targetFacing = options.align === "source" ? source : undefined;
    const sourcePort = endPort(source, sourcePortId, sourceFacing);
    const targetPort = endPort(target, targetPortId, targetFacing);
    use(source, sourcePort, "source");
    use(target, targetPort, "target");
    const line = flowEdge(source, sourcePort.id, target, targetPort.id, options);
    if (ids.has(line.id)) throw problem(`has two edges from ${sourceEnd} to ${targetEnd}.`);
    ids.add(line.id);
    if (options.label) {
      const place = labelPlace(
        { ...point(source, sourcePort), side: sourcePort.side },
        { ...point(target, targetPort), side: targetPort.side },
        options,
      );
      const label: EdgeLabel = { id: line.id, text: options.label, ...place };
      if (options.kind) label.kind = options.kind;
      labels.push(label);
    }
    return line;
  });

  for (const node of nodes) {
    const { box, ports } = find(node.id);
    const used = [...ports.values()];
    node.data.ports = used;
    // The handles let the server draw the edges before the script measures the nodes. Each
    // handle is 1px wide and centered on its port, as `flow.css` draws it.
    node.handles = used.flatMap((port) => {
      const { x, y } = portPoint(port, box);
      return port.types.map((type) => ({
        id: `${port.id}-${type}`,
        type,
        position: POSITIONS[port.side],
        x: x - HANDLE / 2,
        y: y - HANDLE / 2,
        width: HANDLE,
        height: HANDLE,
      }));
    });
  }
  return { width: layout.width, height: layout.height, nodes, edges, labels };
}

/** The size of a handle. */
const HANDLE = 1;
/** The distance from a node to the first turn of a line, when the edge gives none. */
const DEFAULT_OFFSET = 20;

type End = Point & { side: Side };

/**
 * The center of the label of a line: the middle of a straight line, the middle of the outer part
 * of a line that leaves and enters on the same side, or the place that React Flow gives the label
 * of a line with turns. React Flow draws the outer part at `offset` past the farther port, and
 * puts its own label on the longest part, which can be a short leg. A label on a vertical outer
 * part reads from top to bottom.
 */
function labelPlace(
  source: End,
  target: End,
  { step, offset = DEFAULT_OFFSET, labelAt }: EdgeOptions,
): Omit<EdgeLabel, "id" | "text" | "kind"> {
  const middle = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 };
  if (labelAt) return { x: source.x + labelAt.x, y: source.y + labelAt.y, vertical: false };
  if (!step) return { ...middle, vertical: false };
  switch (source.side === target.side ? source.side : undefined) {
    case "right":
      return { x: Math.max(source.x, target.x) + offset, y: middle.y, vertical: true };
    case "left":
      return { x: Math.min(source.x, target.x) - offset, y: middle.y, vertical: true };
    case "bottom":
      return { x: middle.x, y: Math.max(source.y, target.y) + offset, vertical: false };
    case "top":
      return { x: middle.x, y: Math.min(source.y, target.y) - offset, vertical: false };
    default: {
      const [, x, y] = getSmoothStepPath({
        sourceX: source.x,
        sourceY: source.y,
        sourcePosition: POSITIONS[source.side],
        targetX: target.x,
        targetY: target.y,
        targetPosition: POSITIONS[target.side],
        offset,
      });
      return { x, y, vertical: false };
    }
  }
}

function flowEdge(
  source: string,
  sourcePort: string,
  target: string,
  targetPort: string,
  { kind, step, still, offset }: EdgeOptions,
): Edge {
  const line: Edge & { pathOptions?: SmoothStepPathOptions } = {
    id: `${source}.${sourcePort}-${target}.${targetPort}`,
    source,
    target,
    sourceHandle: `${sourcePort}-source`,
    targetHandle: `${targetPort}-target`,
    type: step ? "smoothstep" : "straight",
    animated: !still,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    // The figure label describes the diagram; React Flow would name each edge by its node IDs.
    ariaRole: "presentation",
    domAttributes: { "aria-hidden": true },
  };
  if (offset !== undefined) line.pathOptions = { offset, borderRadius: 10 };
  const className = [kind ? `docs-flow-edge-${kind}` : "", still ? "docs-flow-edge-still" : ""]
    .filter(Boolean)
    .join(" ");
  if (className) line.className = className;
  return line;
}

/**
 * A diagram with a wide and a phone layout. It throws when a layout misses a box, puts a node
 * outside the canvas or outside its parent, gives an unknown tone, or has an edge to an unknown
 * node or port. React Flow drops such an edge without an error in production.
 */
export function defineDiagram<N extends Record<string, NodeSpec>>(spec: DiagramSpec<N>): Diagram {
  return {
    name: spec.name,
    label: spec.label,
    wide: resolveLayout(spec, "wide"),
    narrow: resolveLayout(spec, "narrow"),
  };
}
