export type BorderRaySize = {
  width: number;
  height: number;
  radius: number;
  borderWidth: number;
};

export const BORDER_RAY_DEFAULT_LENGTH_RATIO = 0.15;
export const BORDER_RAY_DEFAULT_LENGTH_MIN = 50;
export const BORDER_RAY_DEFAULT_LENGTH_MAX = 320;
export const BORDER_RAY_DEFAULT_TURN_DURATION_MS = 3000;
export const BORDER_RAY_DEFAULT_STROKE_WIDTH = 4.4;

export const DEFAULT_BORDER_RAY_SIZE: BorderRaySize = {
  width: 680,
  height: 460,
  radius: 12,
  borderWidth: 1,
};

export function computeBorderRayLength(
  perimeter: number,
  ratio = BORDER_RAY_DEFAULT_LENGTH_RATIO,
  min = BORDER_RAY_DEFAULT_LENGTH_MIN,
  max = BORDER_RAY_DEFAULT_LENGTH_MAX,
): number {
  return Math.min(Math.max(perimeter * ratio, min), max);
}

type BorderRayEdge = "top" | "right" | "bottom" | "left";

/** A bar position along its edge at one point of the turn. */
export type BorderRayStop = { offset: number; distance: number };

type BorderRaySegment = {
  edge: BorderRayEdge;
  /** The stroke band of the edge, up to the middle of each corner. */
  clipPath: string;
  barWidth: number;
  barHeight: number;
  /** Moves the bar so its tail follows the ray over one turn. */
  keyframes: Keyframe[];
};

type BorderRayGeometry = {
  /** The layer sits outside the host by this margin, so the outer half of the stroke fits. */
  margin: number;
  width: number;
  height: number;
  segments: BorderRaySegment[];
};

type BorderRayOptions = {
  insetOffset: number;
  strokeWidth: number;
  rayLengthRatio: number;
  rayLengthMin: number;
  rayLengthMax: number;
};

type Point = { x: number; y: number };

const round = (value: number): number => Math.round(value * 1000) / 1000;

const pointAt = (center: Point, radius: number, degrees: number): string => {
  const radians = (degrees * Math.PI) / 180;
  return `${round(center.x + radius * Math.cos(radians))} ${round(center.y + radius * Math.sin(radians))}`;
};

/**
 * The stroke band of one edge, from the middle of its first corner to the middle of its last
 * corner. The four bands cover the stroke of the rounded box once.
 */
const segmentPath = (
  start: Point,
  end: Point,
  angle: number,
  outer: number,
  inner: number,
): string =>
  [
    `M ${pointAt(start, outer, angle - 45)}`,
    `A ${round(outer)} ${round(outer)} 0 0 1 ${pointAt(start, outer, angle)}`,
    `L ${pointAt(end, outer, angle)}`,
    `A ${round(outer)} ${round(outer)} 0 0 1 ${pointAt(end, outer, angle + 45)}`,
    `L ${pointAt(end, inner, angle + 45)}`,
    `A ${round(inner)} ${round(inner)} 0 0 0 ${pointAt(end, inner, angle)}`,
    `L ${pointAt(start, inner, angle)}`,
    `A ${round(inner)} ${round(inner)} 0 0 0 ${pointAt(start, inner, angle - 45)}`,
    "Z",
  ].join(" ");

/**
 * The tail position of the ray on one edge over one turn. The ray moves `travel` per turn and
 * covers `length` from its tail. The bar jumps back while it is off the edge, so the jump stays
 * hidden.
 */
export function computeBorderRayStops(
  edgeStart: number,
  travel: number,
  length: number,
): BorderRayStop[] {
  const end = travel - length;
  const jump = (((edgeStart - length) % travel) + travel) % travel;
  if (jump === 0) {
    return [
      { offset: 0, distance: -length },
      { offset: 1, distance: end },
    ];
  }
  const first = end - jump;
  const offset = jump / travel;
  return [
    { offset: 0, distance: first },
    { offset, distance: end },
    { offset, distance: -length },
    { offset: 1, distance: first },
  ];
}

/**
 * Splits the border into four edge bands. Each band holds one bar that moves along its edge with
 * a transform, so the compositor runs the ray and no frame repaints it.
 */
export function computeBorderRayGeometry(
  size: BorderRaySize,
  options: BorderRayOptions,
): BorderRayGeometry {
  const stroke = Math.max(options.strokeWidth, 0.5);
  const half = stroke / 2;
  const width = Math.max(size.width, 1);
  const height = Math.max(size.height, 1);
  const inset = Math.max(size.borderWidth / 2, 0.5) + options.insetOffset;
  const pathWidth = Math.max(width - inset * 2, 1);
  const pathHeight = Math.max(height - inset * 2, 1);
  const radius = Math.max(0, Math.min(size.radius - inset, pathWidth / 2, pathHeight / 2));
  const perimeter = Math.max(1, 2 * (pathWidth + pathHeight - 4 * radius) + 2 * Math.PI * radius);
  // The bars move along the sides of the path box, so a turn covers the box perimeter.
  const travel = 2 * (pathWidth + pathHeight);
  // A ray that is at most half a turn long leaves each edge before its bar jumps back.
  const length = Math.min(
    computeBorderRayLength(
      perimeter,
      options.rayLengthRatio,
      options.rayLengthMin,
      options.rayLengthMax,
    ),
    travel / 2,
  );
  const margin = Math.ceil(Math.max(0, half - inset)) + 1;
  const layerWidth = width + margin * 2;
  const layerHeight = height + margin * 2;
  const left = margin + inset;
  const top = margin + inset;
  const right = left + pathWidth;
  const bottom = top + pathHeight;
  const topLeft = { x: left + radius, y: top + radius };
  const topRight = { x: right - radius, y: top + radius };
  const bottomRight = { x: right - radius, y: bottom - radius };
  const bottomLeft = { x: left + radius, y: bottom - radius };
  // Each edge runs clockwise from its first corner. `start` is its place in the turn, and
  // `translate` puts the tail of the bar at a distance from the start of the edge.
  const edges = [
    {
      edge: "top",
      angle: -90,
      from: topLeft,
      to: topRight,
      start: 0,
      translate: (distance: number) => `translate(${round(left + distance)}px, 0px)`,
    },
    {
      edge: "right",
      angle: 0,
      from: topRight,
      to: bottomRight,
      start: pathWidth,
      translate: (distance: number) => `translate(0px, ${round(top + distance)}px)`,
    },
    {
      edge: "bottom",
      angle: 90,
      from: bottomRight,
      to: bottomLeft,
      start: pathWidth + pathHeight,
      translate: (distance: number) => `translate(${round(right - distance - length)}px, 0px)`,
    },
    {
      edge: "left",
      angle: 180,
      from: bottomLeft,
      to: topLeft,
      start: 2 * pathWidth + pathHeight,
      translate: (distance: number) => `translate(0px, ${round(bottom - distance - length)}px)`,
    },
  ] as const;
  const segments = edges.map((side): BorderRaySegment => {
    const isHorizontal = side.edge === "top" || side.edge === "bottom";
    return {
      edge: side.edge,
      clipPath: `path("${segmentPath(
        side.from,
        side.to,
        side.angle,
        radius + half,
        Math.max(radius - half, 0),
      )}")`,
      barWidth: round(isHorizontal ? length : layerWidth),
      barHeight: round(isHorizontal ? layerHeight : length),
      keyframes: computeBorderRayStops(side.start, travel, length).map((stop) => ({
        offset: stop.offset,
        transform: side.translate(stop.distance),
      })),
    };
  });
  return { margin, width: layerWidth, height: layerHeight, segments };
}
