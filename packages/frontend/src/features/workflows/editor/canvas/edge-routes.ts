import type { CanvasLinkKind } from "../model/canvas-graph";
import { type Box, boxesOverlap, type Point, unionBox } from "./canvas-geometry";
import { ENTRY_LABEL_MAX_WIDTH, type LabelSize, labelSize } from "./label-size";

export type EdgeRoute = {
  readonly path: string;
  /** The center of the label. */
  readonly label: Point;
  readonly labelBox: Box;
  /** The box around the line and its label. */
  readonly extent: Box;
  /** The start and the end of an arrow. A loop has none. */
  readonly ends?: readonly [Point, Point];
};
export type RoutedLink = {
  readonly id: string;
  readonly kind: CanvasLinkKind;
  readonly source: string;
  readonly target: string;
  /** The label text, which decides the label size. */
  readonly text: string;
  /** The line shows its label. A line without one keeps no room for it. */
  readonly labelled: boolean;
  /** The label shows a problem mark, which takes room too. */
  readonly marked?: boolean;
};

const NO_LABEL = { width: 0, height: 0 };

/** The size of the label of a link, or none for a link without a label. */
const sizeOf = (link: RoutedLink, maxWidth?: number): LabelSize =>
  link.labelled ? labelSize(link.text, maxWidth, link.marked) : NO_LABEL;

export type Side = "top" | "right" | "bottom" | "left";
const STEP = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
} satisfies Record<Side, Point>;

/** The straight run out of a side before a detour turns. */
const HANDLE_RUN = 20;
/** The gap between a detour and the boxes that it passes. */
const CLEARANCE = 32;
/** A line keeps this far from the boxes that it does not link. */
const MARGIN = 24;
/** In a gap too narrow for `MARGIN`, a line may pass this close, but never through a box. */
const TIGHT_MARGIN = 6;
const CORNER_RADIUS = 8;
/** The space between the ends of the lines on one side of a box. */
const PORT_GAP = 40;
/** The space between parallel lines in one gap. */
const LANE_GAP = 16;
/** The gap between a label and the line that it sits next to. */
const LABEL_GAP = 6;
const LOOP_SPAN = 20;
const LOOP_DEPTH = 52;
/** How much wider each next loop of one box runs. */
const LOOP_STEP = 18;
/** The length of an entry arrow, from its label to the box side. */
const ENTRY_RUN = 44;

const centerOf = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const right = (box: Box) => box.x + box.width;
const bottom = (box: Box) => box.y + box.height;
const vertical = (side: Side) => side === "top" || side === "bottom";

/**
 * The sides that an arrow leaves and enters, from the relative place of its boxes: a box below
 * links bottom to top, a box at the right links right to left, and so on. The axis with the larger
 * gap between the boxes wins.
 */
export const arrowSides = (source: Box, target: Box): readonly [Side, Side] => {
  const from = centerOf(source);
  const to = centerOf(target);
  const gapX = Math.abs(to.x - from.x) - (source.width + target.width) / 2;
  const gapY = Math.abs(to.y - from.y) - (source.height + target.height) / 2;
  if (gapY >= gapX) return to.y >= from.y ? ["bottom", "top"] : ["top", "bottom"];
  return to.x >= from.x ? ["right", "left"] : ["left", "right"];
};

type Attachment = { readonly linkId: string; readonly end: 0 | 1; readonly toward: Point };
type Arrow = {
  readonly link: RoutedLink;
  readonly boxes: readonly [Box, Box];
  readonly sides: readonly [Side, Side];
};

/**
 * The end points of the arrows. The ends on one side of a box keep `PORT_GAP` apart, in the order
 * of the boxes that they lead to, so parallel lines do not overlap or cross. The end that leads
 * straight ahead keeps the middle of the side, so the main chain stays on one line.
 */
const portPoints = (arrows: readonly Arrow[]): Map<string, [Point, Point]> => {
  const groups = new Map<string, { box: Box; side: Side; ends: Attachment[] }>();
  for (const { link, boxes, sides } of arrows)
    for (const end of [0, 1] as const) {
      const key = `${end === 0 ? link.source : link.target}\u0000${sides[end]}`;
      const group = groups.get(key) ?? { box: boxes[end], side: sides[end], ends: [] };
      group.ends.push({ linkId: link.id, end, toward: centerOf(boxes[end === 0 ? 1 : 0]) });
      groups.set(key, group);
    }
  const ports = new Map<string, [Point, Point]>();
  for (const { box, side, ends } of groups.values()) {
    const along = vertical(side) ? "x" : "y";
    const center = centerOf(box);
    ends.sort(
      (left, right) =>
        left.toward[along] - right.toward[along] || left.linkId.localeCompare(right.linkId),
    );
    const length = vertical(side) ? box.width : box.height;
    const reach = length / 2 - 16;
    const gap = Math.min(PORT_GAP, (reach * 2) / Math.max(1, ends.length - 1));
    // The straight end leads most nearly straight ahead, and to the nearest box on a tie.
    const across = along === "x" ? "y" : "x";
    const cost = ({ toward }: Attachment) =>
      Math.abs(toward[along] - center[along]) * 1000 + Math.abs(toward[across] - center[across]);
    const costs = ends.map(cost);
    const straight = costs.indexOf(Math.min(...costs));
    // The straight end takes the middle, unless the other ends then leave the side.
    const first = Math.max(-reach, Math.min(-straight * gap, reach - (ends.length - 1) * gap));
    ends.forEach(({ linkId, end }, index) => {
      const offset = first + index * gap;
      const point = {
        top: { x: center.x + offset, y: box.y },
        bottom: { x: center.x + offset, y: bottom(box) },
        left: { x: box.x, y: center.y + offset },
        right: { x: right(box), y: center.y + offset },
      }[side];
      const pair = ports.get(linkId) ?? [point, point];
      pair[end] = point;
      ports.set(linkId, pair);
    });
  }
  return ports;
};

type Obstacle = { readonly id: string; readonly box: Box };
type Segment = { readonly from: Point; readonly to: Point };

const segmentBox = ({ from, to }: Segment, pad: number): Box => ({
  x: Math.min(from.x, to.x) - pad,
  y: Math.min(from.y, to.y) - pad,
  width: Math.abs(to.x - from.x) + pad * 2,
  height: Math.abs(to.y - from.y) + pad * 2,
});

const segmentsOf = (points: readonly Point[]): Segment[] =>
  points.slice(1).map((to, index) => ({ from: points[index]!, to }));

/** Whether a route passes no box. Its first segment leaves the source, its last enters the target. */
const isClear = (
  points: readonly Point[],
  obstacles: readonly Obstacle[],
  link: RoutedLink,
  margin = MARGIN,
): boolean => {
  const segments = segmentsOf(points);
  return segments.every((segment, index) =>
    obstacles.every(({ id, box }) => {
      if (id === link.source && index === 0) return true;
      if (id === link.target && index === segments.length - 1) return true;
      // The line may pass close to its own boxes, but keeps away from the others.
      const pad = id === link.source || id === link.target ? 2 : margin;
      return !boxesOverlap(segmentBox(segment, 0), {
        x: box.x - pad,
        y: box.y - pad,
        width: box.width + pad * 2,
        height: box.height + pad * 2,
      });
    }),
  );
};

/** The channels that placed lines use, so a new line in the same gap takes the next lane. */
class Lanes {
  private readonly used: { horizontal: boolean; at: number; low: number; high: number }[] = [];

  /** The free coordinate nearest to `at` for a channel segment from `low` to `high`. */
  free(horizontal: boolean, at: number, low: number, high: number): number {
    for (const shift of [0, 1, -1, 2, -2, 3, -3]) {
      const candidate = at + shift * LANE_GAP;
      const taken = this.used.some(
        (lane) =>
          lane.horizontal === horizontal &&
          Math.abs(lane.at - candidate) < LANE_GAP / 2 &&
          lane.low < high &&
          low < lane.high,
      );
      if (!taken) return candidate;
    }
    return at;
  }

  /** Takes the inner segments of a chosen route. The end segments sit on their own ports. */
  take(points: readonly Point[]): void {
    for (const { from, to } of segmentsOf(points).slice(1, -1)) {
      const horizontal = from.y === to.y;
      this.used.push({
        horizontal,
        at: horizontal ? from.y : from.x,
        low: horizontal ? Math.min(from.x, to.x) : Math.min(from.y, to.y),
        high: horizontal ? Math.max(from.x, to.x) : Math.max(from.y, to.y),
      });
    }
  }
}

/**
 * The candidate routes of an arrow, best first: a straight line, one bend in the middle of the gap,
 * then detours around the boxes that the run passes on each side.
 */
const arrowCandidates = (
  [start, end]: readonly [Point, Point],
  sides: readonly [Side, Side],
  obstacles: readonly Obstacle[],
  lanes: Lanes,
): Point[][] => {
  const upright = vertical(sides[0]);
  const along = upright ? "x" : "y";
  const across = upright ? "y" : "x";
  const at = (main: number, cross: number): Point =>
    upright ? { x: main, y: cross } : { x: cross, y: main };
  const candidates: Point[][] = [];
  if (Math.abs(start[along] - end[along]) < 1) candidates.push([start, end]);
  else {
    const middle = (start[across] + end[across]) / 2;
    const low = Math.min(start[along], end[along]);
    const high = Math.max(start[along], end[along]);
    const channel = lanes.free(upright, middle, low, high);
    candidates.push([start, at(start[along], channel), at(end[along], channel), end]);
  }
  const outward = (point: Point, side: Side): Point => ({
    x: point.x + STEP[side].x * HANDLE_RUN,
    y: point.y + STEP[side].y * HANDLE_RUN,
  });
  const out = outward(start, sides[0]);
  const into = outward(end, sides[1]);
  const spanLow = Math.min(out[across], into[across]);
  const spanHigh = Math.max(out[across], into[across]);
  const spanned = obstacles.filter(({ box }) =>
    upright ? box.y < spanHigh && bottom(box) > spanLow : box.x < spanHigh && right(box) > spanLow,
  );
  if (spanned.length > 0) {
    const before = Math.min(...spanned.map(({ box }) => (upright ? box.x : box.y))) - CLEARANCE;
    const after =
      Math.max(...spanned.map(({ box }) => (upright ? right(box) : bottom(box)))) + CLEARANCE;
    const cost = (value: number) => Math.abs(start[along] - value) + Math.abs(end[along] - value);
    for (const side of cost(before) <= cost(after) ? [before, after] : [after, before]) {
      const lane = lanes.free(!upright, side, spanLow, spanHigh);
      candidates.push([start, out, at(lane, out[across]), at(lane, into[across]), into, end]);
    }
  }
  return candidates;
};

const toward = (from: Point, to: Point, distance: number): Point => {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return {
    x: from.x + ((to.x - from.x) / length) * distance,
    y: from.y + ((to.y - from.y) / length) * distance,
  };
};

/** An SVG path through the points, with round corners. */
const roundedPath = (points: readonly Point[]): string => {
  const first = points[0]!;
  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const corner = points[index]!;
    const next = points[index + 1]!;
    const radius = Math.min(
      CORNER_RADIUS,
      Math.hypot(corner.x - previous.x, corner.y - previous.y) / 2,
      Math.hypot(next.x - corner.x, next.y - corner.y) / 2,
    );
    const before = toward(corner, previous, radius);
    const after = toward(corner, next, radius);
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const last = points[points.length - 1]!;
  return `${path} L ${last.x} ${last.y}`;
};

/**
 * The places for the label of a route, best first: along its middle segment, then along the
 * others. The label sits next to the line, never on it, so no line runs through a label.
 */
const labelSpots = (points: readonly Point[], size: LabelSize): Point[] => {
  const segments = segmentsOf(points);
  const middle = Math.floor((segments.length - 1) / 2);
  const length = ({ from, to }: Segment) => Math.hypot(to.x - from.x, to.y - from.y);
  const order = [
    middle,
    ...segments
      .map((_, index) => index)
      .filter((index) => index !== middle)
      .sort((left, right) => length(segments[right]!) - length(segments[left]!)),
  ];
  return order.flatMap((index) => {
    const { from, to } = segments[index]!;
    const upright = from.x === to.x;
    const side = (upright ? size.width : size.height) / 2 + LABEL_GAP;
    return [0.5, 0.35, 0.65, 0.2, 0.8].flatMap((share) => {
      const at = { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share };
      return [side, -side].map((shift) =>
        upright ? { x: at.x + shift, y: at.y } : { x: at.x, y: at.y + shift },
      );
    });
  });
};

const overlapArea = (left: Box, right: Box): number =>
  Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)) *
  Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));

const centeredBox = (center: Point, { width, height }: LabelSize): Box => ({
  x: center.x - width / 2,
  y: center.y - height / 2,
  width,
  height,
});

const pointsBox = (points: readonly Point[]): Box => {
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

/**
 * A loop on the right side of a box, with its label after the loop. The loops of one box nest:
 * each next loop runs wider, and the labels stack after the widest loop, in loop order.
 */
const loopRoute = (box: Box, link: RoutedLink, place: number, count: number): EdgeRoute => {
  const side = right(box);
  const middle = box.y + box.height / 2;
  const depth = LOOP_DEPTH + place * LOOP_STEP;
  const span = Math.min(LOOP_SPAN + place * (LOOP_STEP / 3), box.height / 2 - 2);
  const outerApex = (LOOP_DEPTH + (count - 1) * LOOP_STEP) * 0.75;
  const size = sizeOf(link);
  const label = {
    x: side + outerApex + LABEL_GAP + size.width / 2,
    y: middle + (place - (count - 1) / 2) * (size.height + 6),
  };
  const labelBox = centeredBox(label, size);
  // Both ends run level with the box side, so the arrowhead meets the border straight on.
  const path = `M ${side} ${middle - span} C ${side + depth} ${middle - span}, ${side + depth} ${middle + span}, ${side} ${middle + span}`;
  return {
    path,
    label,
    labelBox,
    extent: unionBox([labelBox, { x: side, y: middle - span, width: depth, height: 2 * span }]),
  };
};

/**
 * An entry on the left side of a box, with its label before the entry. The entries of one box
 * stack: their labels keep apart, and they meet at the middle of the box side, so their
 * arrowheads make one.
 */
const entryRoute = (box: Box, link: RoutedLink, place: number, count: number): EdgeRoute => {
  const middle = box.y + box.height / 2;
  const size = sizeOf(link, ENTRY_LABEL_MAX_WIDTH);
  const start = { x: box.x - ENTRY_RUN, y: middle + (place - (count - 1) / 2) * (size.height + 6) };
  const end = { x: box.x, y: middle };
  const label = { x: start.x - LABEL_GAP - size.width / 2, y: start.y };
  const labelBox = centeredBox(label, size);
  // Both ends run level, so the arrowhead meets the border straight on.
  const bend = ENTRY_RUN / 2;
  const path = `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
  return {
    path,
    label,
    labelBox,
    extent: unionBox([labelBox, pointsBox([start, end])]),
  };
};

/**
 * The route of each link between the boxes. Each arrow leaves and enters the sides that face the
 * other box, keeps clear of every box when a clear route exists, and takes its own lane in a
 * shared gap. Each label sits on its own line, clear of the boxes, the other labels, and the
 * other lines when a free spot exists.
 */
export const routeLinks = (
  links: readonly RoutedLink[],
  boxes: ReadonlyMap<string, Box>,
): Map<string, EdgeRoute> => {
  const routes = new Map<string, EdgeRoute>();
  const loops = links.filter(({ kind }) => kind === "loop");
  for (const link of loops) {
    const box = boxes.get(link.source);
    const siblings = loops.filter(({ source }) => source === link.source);
    if (box) routes.set(link.id, loopRoute(box, link, siblings.indexOf(link), siblings.length));
  }
  const entries = links.filter(({ kind }) => kind === "entry");
  for (const link of entries) {
    const box = boxes.get(link.target);
    const siblings = entries.filter(({ target }) => target === link.target);
    if (box) routes.set(link.id, entryRoute(box, link, siblings.indexOf(link), siblings.length));
  }
  // The loops and the entries of a box belong to it, so the arrows keep clear of them. Each one
  // stays its own obstacle: the box around a box and its stacked entry labels would close the
  // gaps above and below the box, and leave a line no clear route.
  const attached = [...loops, ...entries];
  const obstacles: Obstacle[] = [...boxes].flatMap(([id, box]) => [
    { id, box },
    ...attached.flatMap(({ id: linkId, source }) => {
      const extent = source === id ? routes.get(linkId)?.extent : undefined;
      return extent ? [{ id, box: extent }] : [];
    }),
  ]);
  const arrows = links.flatMap((link): Arrow[] => {
    const source = boxes.get(link.source);
    const target = boxes.get(link.target);
    if (link.kind !== "arrow" || !source || !target) return [];
    return [{ link, boxes: [source, target], sides: arrowSides(source, target) }];
  });
  const ports = portPoints(arrows);
  const lanes = new Lanes();
  const lines = arrows.map(({ link, sides }) => {
    const candidates = arrowCandidates(ports.get(link.id)!, sides, obstacles, lanes);
    const points =
      candidates.find((candidate) => isClear(candidate, obstacles, link)) ??
      candidates.find((candidate) => isClear(candidate, obstacles, link, TIGHT_MARGIN)) ??
      candidates[0]!;
    lanes.take(points);
    return { link, points };
  });
  const placed: Box[] = [...routes.values()].map(({ labelBox }) => labelBox);
  // Every line counts, its own too, so no line runs through a label.
  const lineBoxes = lines.flatMap((line) =>
    segmentsOf(line.points).map((segment) => segmentBox(segment, 2)),
  );
  for (const { link, points } of lines) {
    const size = sizeOf(link);
    // The first free place wins. Without one, the place that covers the least wins: a box
    // counts most, then another label, then a line.
    const cost = (box: Box) =>
      obstacles.reduce((sum, obstacle) => sum + overlapArea(box, obstacle.box) * 10, 0) +
      placed.reduce((sum, other) => sum + overlapArea(box, other) * 5, 0) +
      lineBoxes.reduce((sum, other) => sum + overlapArea(box, other), 0);
    const spots = labelSpots(points, size);
    let label = spots[0]!;
    let lowest = Number.POSITIVE_INFINITY;
    for (const spot of link.labelled ? spots : []) {
      const value = cost(centeredBox(spot, size));
      if (value < lowest) {
        lowest = value;
        label = spot;
      }
      if (value === 0) break;
    }
    const labelBox = centeredBox(label, size);
    if (link.labelled) placed.push(labelBox);
    routes.set(link.id, {
      path: roundedPath(points),
      ends: [points[0]!, points.at(-1)!],
      label,
      labelBox,
      extent: link.labelled ? unionBox([pointsBox(points), labelBox]) : pointsBox(points),
    });
  }
  return routes;
};
