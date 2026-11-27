// The geometry of the workflow canvas: the fit and the reveal of canvas/canvas-viewport.ts in
// packages/frontend/src/features/workflows/editor, and the path of a line through its corners, as
// roundedPath of edge-routes.ts draws it. The views and the scenes compute them for the size of
// the canvas in each layout of the stage. src/copied-workflow-editor.test.ts compares them with
// the product.
import type { Point } from "../../motion/offset";
import type { Box, Viewport } from "./model";

/** MIN_FIT_ZOOM of canvas-viewport.ts: the lowest zoom of a fit that keeps the text readable. */
const MIN_FIT_ZOOM = 0.8;
/** MAX_FIT_ZOOM: every workflow that fits opens at this zoom. */
const MAX_FIT_ZOOM = 0.85;
/** The room of the toolbar above and of the zoom controls at the bottom left. */
const PADDING = { top: 64, right: 40, bottom: 48, left: 64 };
/** REVEAL_MARGIN: the space that a revealed selection keeps from the edges. */
const REVEAL_MARGIN = 48;
/** CORNER_RADIUS of edge-routes.ts. */
const CORNER_RADIUS = 8;

/** Seconds of a move of the viewport: VIEWPORT_MOVE_MS of use-viewport-mover.ts. */
export const VIEWPORT_MOVE = 0.2;

/**
 * HINT_ROOM of canvas-overlays.tsx: the "More below" control shows while the workflow reaches
 * past this space above the canvas bottom.
 */
export const HINT_ROOM = 24;

/** The size of the canvas in design pixels. */
export type CanvasSize = { readonly width: number; readonly height: number };

/**
 * readableViewport of canvas-viewport.ts: the viewport that shows the whole workflow at a zoom
 * between MIN_FIT_ZOOM and MAX_FIT_ZOOM, with `x` from the left of the canvas. A workflow that
 * does not fit shows from its start, and an axis that fits is centered.
 */
export function readableViewport(bounds: Box, size: CanvasSize): Viewport {
  const roomX = size.width - PADDING.left - PADDING.right;
  const roomY = size.height - PADDING.top - PADDING.bottom;
  const zoom = Math.min(
    MAX_FIT_ZOOM,
    Math.max(MIN_FIT_ZOOM, Math.min(roomX / bounds.width, roomY / bounds.height)),
  );
  const place = (start: number, room: number, from: number, length: number): number =>
    start + Math.max(0, (room - length * zoom) / 2) - from * zoom;
  return {
    x: place(PADDING.left, roomX, bounds.x, bounds.width),
    y: place(PADDING.top, roomY, bounds.y, bounds.height),
    zoom,
  };
}

/**
 * revealViewport of canvas-viewport.ts: the smallest pan that shows a selection, with its
 * neighbours when they fit, else the selection alone, with `x` from the left of the canvas. A
 * selection in view keeps the viewport.
 */
export function revealViewport(
  viewport: Viewport,
  size: CanvasSize,
  selection: Box,
  neighbours: Box,
): Viewport {
  const { zoom } = viewport;
  const fits = (box: Box): boolean =>
    box.width * zoom <= size.width - REVEAL_MARGIN * 2 &&
    box.height * zoom <= size.height - REVEAL_MARGIN * 2;
  const shown = fits(neighbours) ? neighbours : selection;
  const shift = (offset: number, start: number, length: number, room: number): number => {
    const low = start * zoom + offset;
    const high = (start + length) * zoom + offset;
    if (low < REVEAL_MARGIN) return offset + REVEAL_MARGIN - low;
    if (high > room - REVEAL_MARGIN) return offset - (high - room + REVEAL_MARGIN);
    return offset;
  };
  return {
    x: shift(viewport.x, shown.x, shown.width, size.width),
    y: shift(viewport.y, shown.y, shown.height, size.height),
    zoom,
  };
}

/** What a selection makes the canvas show: its box or label, and the box with its neighbours. */
export type RevealTarget = { readonly selection: Box; readonly neighbours: Box };

/** A viewport with `x` from the left of the canvas, with `x` from its middle, as the canvas has it. */
export function fromMiddle(viewport: Viewport, size: CanvasSize): Viewport {
  return { ...viewport, x: viewport.x - size.width / 2 };
}

/** A viewport with `x` from the middle of the canvas, with `x` from its left, as the editor has it. */
export function fromLeft(viewport: Viewport, size: CanvasSize): Viewport {
  return { ...viewport, x: viewport.x + size.width / 2 };
}

/**
 * The fit of `bounds` as the canvas holds it, with `x` from the middle of the canvas, then the
 * pan to `target`, as the editor reveals a new selection.
 */
export function fitViewport(bounds: Box, size: CanvasSize, target?: RevealTarget): Viewport {
  const fit = readableViewport(bounds, size);
  return fromMiddle(
    target ? revealViewport(fit, size, target.selection, target.neighbours) : fit,
    size,
  );
}

/**
 * The fit of `bounds` that keeps `room` free at the right and at the bottom of the canvas, such as
 * for a toast over it, with `x` from the middle of the canvas.
 */
export function fitAround(bounds: Box, size: CanvasSize, room: CanvasSize): Viewport {
  const fit = readableViewport(bounds, {
    width: size.width - room.width,
    height: size.height - room.height,
  });
  return fromMiddle(fit, size);
}

/** A line as its corners: its start, the corner of each turn, and its end. */
export type Polyline = readonly Point[];

/**
 * The corners of a path of edge-routes.ts: the start of `M`, the control point of each `Q`, which
 * is the corner of a round turn, and the end of the last `L`.
 */
export function polylineOf(path: string): Polyline {
  const parts = path.match(/[MLQ]|-?\d+(?:\.\d+)?/g) ?? [];
  const points: Point[] = [];
  let last: Point | undefined;
  for (let index = 0; index < parts.length; index += 1) {
    const command = parts[index];
    const read = (offset: number): Point => ({
      x: Number(parts[index + offset]),
      y: Number(parts[index + offset + 1]),
    });
    if (command === "M") points.push(read(1));
    else if (command === "Q") points.push(read(1));
    else if (command === "L") last = read(1);
  }
  if (last) points.push(last);
  return points;
}

const toward = (from: Point, to: Point, distance: number): Point => {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return {
    x: from.x + ((to.x - from.x) / length) * distance,
    y: from.y + ((to.y - from.y) / length) * distance,
  };
};

/** roundedPath of edge-routes.ts: an SVG path through the points, with round corners. */
export function roundedPath(points: Polyline): string {
  const [first] = points;
  if (!first) return "";
  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? first;
    const corner = points[index] ?? first;
    const next = points[index + 1] ?? corner;
    const radius = Math.min(
      CORNER_RADIUS,
      Math.hypot(corner.x - previous.x, corner.y - previous.y) / 2,
      Math.hypot(next.x - corner.x, next.y - corner.y) / 2,
    );
    const before = toward(corner, previous, radius);
    const after = toward(corner, next, radius);
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const end = points[points.length - 1] ?? first;
  return `${path} L ${end.x} ${end.y}`;
}

/** The nearest point of the line from `from` to `to`. */
function nearestOn(point: Point, from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const along =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length));
  return { x: from.x + dx * along, y: from.y + dy * along };
}

/**
 * The points of `line` for each corner of `like`: the start, the end, and for each corner of
 * `like` the nearest point of `line`. Two lines with the same count of points can morph.
 */
export function alignTo(line: Polyline, like: Polyline): Polyline {
  if (line.length === like.length) return line;
  const segments = line.slice(1).map((end, index): [Point, Point] => [line[index] ?? end, end]);
  return like.map((point, index) => {
    if (index === 0) return line[0] ?? point;
    if (index === like.length - 1) return line[line.length - 1] ?? point;
    const spots = segments.map(([from, to]) => nearestOn(point, from, to));
    const distance = (spot: Point): number => Math.hypot(spot.x - point.x, spot.y - point.y);
    return spots.reduce((best, spot) => (distance(spot) < distance(best) ? spot : best));
  });
}
