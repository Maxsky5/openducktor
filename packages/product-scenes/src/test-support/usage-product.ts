// The Usage page of the product as the copied test of the usage scene reads it: the functions of
// the page, the chart libraries that it draws with, and the report of the sample scene as the host
// sends it to the page.
import type { ChartPoint } from "../replicas/usage/curve";
import type { DAY_TEXT, METRIC_TEXT, UsageMetric } from "../replicas/usage/format";
import {
  daysOf,
  reportSessions,
  reportTotal,
  runtimeTotal,
  type UsageReport,
} from "../replicas/usage/model";
import type { RuntimeKind } from "../sample/models";
import { importProduct, importProductDependency } from "./product-source";

const PAGE = "packages/frontend/src/pages/usage";
const FRONTEND = "packages/frontend/package.json";

/** The figure of the app: token counts, sessions, coverage, and the estimated cost. */
type Figure = {
  tokens: Record<"input" | "cacheRead" | "cacheWrite" | "output" | "processed", number>;
  unmeasured: number;
  sessions: number;
  complete: boolean;
  cost: { usd: number; state: "complete"; unpricedTokens: number };
};
type Period = { start: string; end: string; runtimes: { runtime: RuntimeKind; figure: Figure }[] };
type AppReport = {
  timeZone: string;
  range: { start: string; end: string };
  granularity: "day";
  resultAt: string;
  totals: Figure;
  periods: Period[];
  byRuntime: { runtime: RuntimeKind; figure: Figure }[];
  coverage: { runtime: RuntimeKind; state: "complete"; issues: never[] }[];
};
type Highlights = {
  cacheHit: { rate: number | null; cacheRead: number; inputSide: number; note: string | null };
  busiest: { value: number | null; index: number };
  average: { value: number | null; activeCount: number };
  perSession: { value: number | null; sessions: number };
  values: number[];
  note: string | null;
};

// SAFETY: usage-format.ts exports these values and functions, and a missing export fails the test.
export const format = await importProduct<{
  USAGE_RUNTIMES: readonly RuntimeKind[];
  USAGE_RUNTIME_LABELS: Record<RuntimeKind, string>;
  METRIC_TEXT: typeof METRIC_TEXT;
  PERIOD_TEXT: { day: typeof DAY_TEXT };
  formatCompactCount: (value: number) => string;
  formatShare: (value: number) => string;
  formatUsd: (value: number) => string;
  formatMetric: (value: number, metric: UsageMetric) => string;
  formatAxisMetric: (value: number, metric: UsageMetric) => string;
  formatRange: (start: string, end: string) => string;
  periodName: (period: { start: string; end: string }, granularity: "day") => string;
  labelDates: (periods: readonly Period[], count: number, granularity: "day") => Date[];
  dateOf: (isoDate: string) => Date;
  shareOf: (figure: Figure, total: number | null, metric: UsageMetric) => number | null;
  periodTotal: (
    period: Period,
    runtimes: readonly RuntimeKind[],
    metric: UsageMetric,
  ) => { value: number; parts: { runtime: RuntimeKind; value: number | null }[] };
}>(`${PAGE}/usage-format.ts`);
// SAFETY: usage-report.ts exports this function, and a missing export fails the test.
export const { usageHighlights } = await importProduct<{
  usageHighlights: (report: AppReport, metric: UsageMetric) => Highlights;
}>(`${PAGE}/usage-report.ts`);
/** The curve factory of d3-shape that the chart of the app gives to every mark. */
type MonotoneCurve = { readonly monotone: "x" };
/** The area generator of d3-shape, from an x, a base, and a top accessor. */
type AreaGenerator = {
  x: (x: (point: readonly number[]) => number) => AreaGenerator;
  y0: (y: (point: readonly number[]) => number) => AreaGenerator;
  y1: (y: (point: readonly number[]) => number) => AreaGenerator;
  curve: (curve: MonotoneCurve) => (points: readonly (readonly number[])[]) => string;
};
// SAFETY: d3-shape exports these functions, and the chart of the app draws with curveMonotoneX.
export const d3 = await importProductDependency<{
  line: () => { curve: (curve: MonotoneCurve) => (points: readonly ChartPoint[]) => string };
  area: () => AreaGenerator;
  curveMonotoneX: MonotoneCurve;
}>("d3-shape", FRONTEND);
/** The linear scale of @tanstack/charts, with the methods that the y axis of the chart uses. */
type LinearScale = {
  (value: number): number;
  domain(values: readonly number[]): LinearScale;
  domain(): number[];
  range(values: readonly number[]): LinearScale;
  nice(count: number): LinearScale;
  ticks(count: number): number[];
};
/** The time scale of @tanstack/charts, which the x axis of the chart uses. */
type TimeScale = {
  (value: Date): number;
  domain(values: readonly Date[]): TimeScale;
  range(values: readonly number[]): TimeScale;
};

// SAFETY: the linear scale of @tanstack/charts has nice and ticks, which the chart of the app uses.
export const { scaleLinear } = await importProductDependency<{ scaleLinear: () => LinearScale }>(
  "@tanstack/charts/scales/linear",
  FRONTEND,
);
// SAFETY: scales/time exports the UTC scale of the x axis of the chart.
export const { scaleUtc } = await importProductDependency<{ scaleUtc: () => TimeScale }>(
  "@tanstack/charts/scales/time",
  FRONTEND,
);
// SAFETY: tooltip/model exports the placement that the tooltip of the chart uses.
export const { resolveChartTooltipPlacement } = await importProductDependency<{
  resolveChartTooltipPlacement: (
    anchor: { x: number; y: number },
    tooltip: Record<"width" | "height", number>,
    boundary: Record<"left" | "top" | "right" | "bottom", number>,
    placement: readonly string[],
    offset: number,
  ) => { left: number; top: number };
}>("@tanstack/charts/tooltip/model", FRONTEND);

/** The figure of a value: the tokens of the day or the range, and their estimated cost. */
const figure = (tokens: number, cost: number, sessions: number): Figure => ({
  tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: tokens, processed: tokens },
  unmeasured: 0,
  sessions,
  complete: true,
  cost: { usd: cost, state: "complete", unpricedTokens: 0 },
});

/** The report of the sample as the host sends it: a runtime without usage on a day has no entry. */
export function appReport(report: UsageReport): AppReport {
  const days = daysOf(report).map((day) => day.toISOString().slice(0, 10));
  const { cacheRead, cacheWrite, input, output } = report.tokenTypes;
  return {
    timeZone: "UTC",
    range: { start: report.start, end: report.end },
    granularity: "day",
    resultAt: `${report.end}T09:41:00Z`,
    totals: {
      ...figure(reportTotal(report, "tokens"), reportTotal(report, "cost"), reportSessions(report)),
      tokens: {
        input,
        cacheRead,
        cacheWrite,
        output,
        processed: input + cacheRead + cacheWrite + output,
      },
    },
    periods: days.map((day, index) => ({
      start: day,
      end: day,
      runtimes: report.runtimes
        .filter((usage) => (usage.tokens[index] ?? 0) > 0)
        .map((usage) => ({
          runtime: usage.runtime,
          figure: figure(usage.tokens[index] ?? 0, usage.cost[index] ?? 0, 1),
        })),
    })),
    byRuntime: report.runtimes.map((usage) => ({
      runtime: usage.runtime,
      figure: figure(runtimeTotal(usage, "tokens"), runtimeTotal(usage, "cost"), usage.sessions),
    })),
    coverage: report.runtimes.map((usage) => ({
      runtime: usage.runtime,
      state: "complete",
      issues: [],
    })),
  };
}
