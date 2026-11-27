// The geometry of the trend chart of usage-trend-chart.tsx: the plot box, the scales, the ticks,
// the stacked bands of the runtimes, and the place of the tooltip, in the design pixels of a chart
// of one width. The app measures the width of the chart column and lays the chart out for it, and
// the views give the width of their column. The range ends today, so the total ends with the day
// in progress.
import type { RuntimeKind } from "../../sample/models";
import { areaPath, linePath, type ChartPoint } from "./curve";
import {
  formatAxisMetric,
  formatDay,
  labelCountFor,
  labelIndexes,
  type UsageMetric,
} from "./format";
import { dailyTotals, dayCount, dayOf, type UsageReport, valuesOf } from "./model";

/** CHART_HEIGHT of the app. */
const HEIGHT = 280;

/**
 * The chart of one width: its size and its plot. MARGIN of the app keeps a fixed axis gutter, so
 * the plot keeps its place when the metric changes, and a chart under 480 pixels has the narrow
 * gutter of NARROW_MARGIN.
 */
export type ChartBox = {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export const chartBox = (width: number): ChartBox => ({
  width,
  height: HEIGHT,
  left: width < 480 ? 44 : 56,
  right: width - 8,
  top: 12,
  bottom: HEIGHT - 28,
});

/** The number of value ticks of the y axis. */
const TICK_COUNT = 4;

const e10 = Math.sqrt(50);
const e5 = Math.sqrt(10);
const e2 = Math.sqrt(2);

/** The tick step of d3-array for a positive range. */
function tickIncrement(stop: number, count: number): number {
  const step = stop / count;
  const power = Math.floor(Math.log10(step));
  const error = step / 10 ** power;
  const factor = error >= e10 ? 10 : error >= e5 ? 5 : error >= e2 ? 2 : 1;
  return power >= 0 ? factor * 10 ** power : -(10 ** -power) / factor;
}

/** The step of a tick for the signed increment of d3-array. */
const stepOf = (increment: number): number => (increment < 0 ? -1 / increment : increment);

/**
 * The top of the y domain after `nice` of d3-scale with the tick count, which the chart of the
 * app asks for: the largest value, rounded up to a tick.
 */
export function niceTop(max: number): number {
  let stop = max;
  let previous = 0;
  for (let round = 0; round < 10; round += 1) {
    const step = stepOf(tickIncrement(stop, TICK_COUNT));
    if (step === previous) break;
    stop = Math.ceil(stop / step) * step;
    previous = step;
  }
  return stop;
}

/** The value ticks of the y axis, from zero to `top`. */
export function valueTicks(top: number): number[] {
  const step = stepOf(tickIncrement(top, TICK_COUNT));
  return Array.from({ length: Math.floor(top / step + 1e-9) + 1 }, (_, index) => index * step);
}

/** The x of the day at `index` of `days`. The first and the last day sit on the plot edges. */
export const xOf = (box: ChartBox, index: number, days: number): number =>
  box.left + (index * (box.right - box.left)) / Math.max(1, days - 1);

/** The y of a value on an axis from zero to `top`. */
const yOf = (box: ChartBox, value: number, top: number): number =>
  box.bottom - (value / top) * (box.bottom - box.top);

/** The top of the y axis of a metric. */
const axisTop = (report: UsageReport, metric: UsageMetric): number =>
  niceTop(Math.max(...dailyTotals(report, metric)));

/** The point of the total of the day at `index`, where the chart shows the inspected day. */
export const totalPoint = (
  box: ChartBox,
  report: UsageReport,
  metric: UsageMetric,
  index: number,
): ChartPoint => [
  xOf(box, index, dayCount(report)),
  yOf(box, dailyTotals(report, metric)[index] ?? 0, axisTop(report, metric)),
];

/** The gap of the tooltip to the inspected day: `offset` of the tooltip of the chart. */
const TIP_OFFSET = 16;

/** The least distance of the tooltip to the chart edges, which the tooltip of the chart keeps. */
const TIP_EDGE = 8;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

/** The top left corner of the tooltip in the chart. */
type TipPlace = { left: number; top: number };

/**
 * The place of a tooltip of `width` by `height` beside the day at `x`, as the chart of the app
 * picks it: the right side, or the left side when the right side overflows more, at the top of
 * the plot and inside the chart.
 */
export function tipPlace(box: ChartBox, x: number, width: number, height: number): TipPlace {
  const top = box.top - height / 2;
  const sides = [x + TIP_OFFSET, x - TIP_OFFSET - width];
  const overflow = (left: number): number =>
    Math.max(0, TIP_EDGE - left) +
    Math.max(0, left + width + TIP_EDGE - box.width) +
    Math.max(0, TIP_EDGE - top) +
    Math.max(0, top + height + TIP_EDGE - box.height);
  let left = sides[0] ?? x;
  for (const side of sides) {
    if (overflow(side) === 0) {
      left = side;
      break;
    }
    if (overflow(side) < overflow(left)) left = side;
  }
  return {
    left: clamp(left, TIP_EDGE, box.width - TIP_EDGE - width),
    top: clamp(top, TIP_EDGE, box.height - TIP_EDGE - height),
  };
}

/** A label of an axis at its place in the chart. */
export type AxisLabel = { text: string; at: number };

/** The y axis of a metric: its grid lines and value labels. */
export const yAxis = (box: ChartBox, report: UsageReport, metric: UsageMetric): AxisLabel[] => {
  const top = axisTop(report, metric);
  return valueTicks(top).map((value) => ({
    text: formatAxisMetric(value, metric),
    at: yOf(box, value, top),
  }));
};

/** The date labels of the x axis. The first and the last label anchor inside the plot. */
export const xAxis = (
  box: ChartBox,
  report: UsageReport,
): (AxisLabel & { anchor: "start" | "middle" | "end" })[] => {
  const days = dayCount(report);
  const indexes = labelIndexes(days, labelCountFor(box.width));
  const last = indexes.at(-1);
  return indexes.map((index) => ({
    text: formatDay(dayOf(report, index)),
    at: xOf(box, index, days),
    anchor: index === 0 ? "start" : index === last ? "end" : "middle",
  }));
};

/** The marks of the chart: an area and a top line for each band, and the total line. */
export type TrendMarks = {
  bands: { runtime: RuntimeKind; area: string; line: string }[];
  /** The total over the settled days. */
  total: string;
  /** The dashed segment to the day in progress. */
  current: string;
  /** The open point of the day in progress, or null while that day has no value. */
  today: ChartPoint | null;
};

/**
 * The marks of a metric: the runtimes stacked in report order, each band from the top of the band
 * before it. The total ends with a dashed segment to an open point on the day in progress.
 */
export function marksOf(box: ChartBox, report: UsageReport, metric: UsageMetric): TrendMarks {
  const top = axisTop(report, metric);
  const days = dayCount(report);
  const points = (sums: readonly number[]): ChartPoint[] =>
    sums.map((sum, index): ChartPoint => [xOf(box, index, days), yOf(box, sum, top)]);
  let sums = Array.from({ length: days }, () => 0);
  let base = points(sums);
  const bands = report.runtimes.map((usage) => {
    const values = valuesOf(usage, metric);
    sums = sums.map((low, index) => low + (values[index] ?? 0));
    const edge = points(sums);
    const band = { runtime: usage.runtime, area: areaPath(edge, base), line: linePath(edge) };
    base = edge;
    return band;
  });
  const last = base.at(-1);
  return {
    bands,
    total: linePath(base.slice(0, -1)),
    current: linePath(base.slice(-2)),
    today: last && last[1] < box.bottom ? last : null,
  };
}
