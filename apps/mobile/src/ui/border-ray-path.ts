/** The desktop ray length: 12% of the edge, from 50 to 320 points. */
const LENGTH_RATIO = 0.12;
const LENGTH_MIN = 50;
const LENGTH_MAX = 320;
/** The desktop ray runs half a point outside the edge of a card without a border. */
const INSET = -0.5;

/** The rounded rectangle that the ray runs along, in the coordinates of the card. */
export type RayPath = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  radius: number;
  /** The lengths of a horizontal edge, a vertical edge, and a corner arc. */
  across: number;
  down: number;
  arc: number;
  perimeter: number;
  rayLength: number;
};

/** The edge of a card of `size` with corners of `radius`, as the desktop `BorderRay` draws it. */
export const rayPath = (size: { width: number; height: number }, radius: number): RayPath => {
  const width = Math.max(size.width - INSET * 2, 1);
  const height = Math.max(size.height - INSET * 2, 1);
  const r = Math.max(0, Math.min(radius - INSET, width / 2, height / 2));
  const across = width - 2 * r;
  const down = height - 2 * r;
  const arc = (Math.PI * r) / 2;
  const perimeter = Math.max(1, 2 * (across + down) + 4 * arc);
  return {
    left: INSET,
    top: INSET,
    right: INSET + width,
    bottom: INSET + height,
    radius: r,
    across,
    down,
    arc,
    perimeter,
    rayLength: Math.min(Math.max(perimeter * LENGTH_RATIO, LENGTH_MIN), LENGTH_MAX),
  };
};

/** A point on the edge, and the direction of the edge there in radians. */
export type RayPoint = { x: number; y: number; angle: number };

/** The point at `distance` along the edge, clockwise from the start of the top edge. */
export const rayPointAt = (path: RayPath, distance: number): RayPoint => {
  "worklet";
  const { left, top, right, bottom, radius: r, across, down, arc, perimeter } = path;
  let s = ((distance % perimeter) + perimeter) % perimeter;
  const onArc = (centerX: number, centerY: number, start: number): RayPoint => {
    const theta = start + s / r;
    return {
      x: centerX + r * Math.cos(theta),
      y: centerY + r * Math.sin(theta),
      angle: theta + Math.PI / 2,
    };
  };
  if (s < across) return { x: left + r + s, y: top, angle: 0 };
  s -= across;
  if (s < arc) return onArc(right - r, top + r, -Math.PI / 2);
  s -= arc;
  if (s < down) return { x: right, y: top + r + s, angle: Math.PI / 2 };
  s -= down;
  if (s < arc) return onArc(right - r, bottom - r, 0);
  s -= arc;
  if (s < across) return { x: right - r - s, y: bottom, angle: Math.PI };
  s -= across;
  if (s < arc) return onArc(left + r, bottom - r, Math.PI / 2);
  s -= arc;
  if (s < down) return { x: left, y: bottom - r - s, angle: -Math.PI / 2 };
  s -= down;
  if (s < arc) return onArc(left + r, top + r, Math.PI);
  return { x: left + r, y: top, angle: 0 };
};
