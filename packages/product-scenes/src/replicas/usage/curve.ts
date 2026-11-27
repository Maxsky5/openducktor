// The monotone curve of the trend chart: curveMonotoneX of d3-shape, which usage-trend-chart.tsx
// gives to every line and area. It writes SVG path data, as d3-path writes it for an SVG path.

/** A point of a chart in design pixels. */
export type ChartPoint = readonly [x: number, y: number];

const sign = (value: number): number => (value < 0 ? -1 : 1);

/** A number of the path data with at most 3 decimals, as d3-path writes it. */
const n = (value: number): string => String(Math.round(value * 1000) / 1000);

/**
 * Writes one monotone line through `points` into `out`. The line starts with a move, or with a
 * line from the current point when `join` is "L", as the second edge of an area does. The x
 * values of the points must all differ: the chart has one point for each day.
 */
function monotoneInto(points: readonly ChartPoint[], out: string[], join: "M" | "L"): void {
  let x0 = Number.NaN;
  let y0 = Number.NaN;
  let x1 = Number.NaN;
  let y1 = Number.NaN;
  let t0 = Number.NaN;
  let state = 0;
  // The tangent at the current point from its two neighbors (Steffen, 1990).
  const slope3 = (x2: number, y2: number): number => {
    const h0 = x1 - x0;
    const h1 = x2 - x1;
    const s0 = (y1 - y0) / h0;
    const s1 = (y2 - y1) / h1;
    const p = (s0 * h1 + s1 * h0) / (h0 + h1);
    return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  };
  // The one-sided tangent at an end of the line.
  const slope2 = (t: number): number => {
    const h = x1 - x0;
    return h ? ((3 * (y1 - y0)) / h - t) / 2 : t;
  };
  // A cubic Hermite segment from (x0, y0) to (x1, y1) as a cubic Bézier curve.
  const segment = (from: number, to: number): void => {
    const dx = (x1 - x0) / 3;
    out.push(
      `C${n(x0 + dx)},${n(y0 + dx * from)},${n(x1 - dx)},${n(y1 - dx * to)},${n(x1)},${n(y1)}`,
    );
  };
  for (const [x, y] of points) {
    let t1 = Number.NaN;
    if (state === 0) {
      state = 1;
      out.push(`${join}${n(x)},${n(y)}`);
    } else if (state === 1) {
      state = 2;
    } else if (state === 2) {
      state = 3;
      t1 = slope3(x, y);
      segment(slope2(t1), t1);
    } else {
      t1 = slope3(x, y);
      segment(t0, t1);
    }
    x0 = x1;
    x1 = x;
    y0 = y1;
    y1 = y;
    t0 = t1;
  }
  if (state === 2) out.push(`L${n(x1)},${n(y1)}`);
  if (state === 3) segment(t0, slope2(t0));
}

/** The path data of a monotone line through `points`. */
export function linePath(points: readonly ChartPoint[]): string {
  const out: string[] = [];
  monotoneInto(points, out, "M");
  return out.join("");
}

/**
 * The path data of a monotone area between `top` and `base`, which have the same x values: the
 * top edge from left to right, then the base edge from right to left, as the area of d3 draws it.
 */
export function areaPath(top: readonly ChartPoint[], base: readonly ChartPoint[]): string {
  const out: string[] = [];
  monotoneInto(top, out, "M");
  monotoneInto([...base].reverse(), out, "L");
  out.push("Z");
  return out.join("");
}
