// The usage report of the copied Usage page and the figures that the page derives from it, as
// usage-overview.tsx, usage-highlights.tsx, and usage-report.ts in packages/frontend/src/pages/usage
// compute them. The report covers whole days and has no gaps: every request has token counts and a
// rate, so no value shows a dash or a warning mark.
import type { RuntimeKind } from "../../sample/models";
import {
  DAY_TEXT,
  dateOf,
  formatCompactCount,
  formatCount,
  formatCountOf,
  formatDay,
  formatMetric,
  formatShare,
  formatUsd,
  METRIC_TEXT,
  type UsageMetric,
} from "./format";

/** The usage of one runtime: its sessions, and its value on each day of the range. */
export type RuntimeUsage = {
  runtime: RuntimeKind;
  sessions: number;
  tokens: readonly number[];
  cost: readonly number[];
};

/** The processed tokens of the range by type. */
type TokenTypes = { cacheRead: number; cacheWrite: number; input: number; output: number };

/**
 * A report of a range of whole days, with the runtimes in the order of the app. The range ends
 * today, so its last day is still in progress.
 */
export type UsageReport = {
  start: string;
  end: string;
  /** The time of the result, as formatTime of the app writes it. */
  updated: string;
  runtimes: readonly RuntimeUsage[];
  tokenTypes: TokenTypes;
};

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

/** The values of a runtime in a metric, day by day. */
export const valuesOf = (usage: RuntimeUsage, metric: UsageMetric): readonly number[] =>
  metric === "tokens" ? usage.tokens : usage.cost;

/** The total of a runtime over the range. */
export const runtimeTotal = (usage: RuntimeUsage, metric: UsageMetric): number =>
  sum(valuesOf(usage, metric));

/** The total of the range in a metric. */
export const reportTotal = (report: UsageReport, metric: UsageMetric): number =>
  sum(report.runtimes.map((usage) => runtimeTotal(usage, metric)));

export const reportSessions = (report: UsageReport): number =>
  sum(report.runtimes.map((usage) => usage.sessions));

/** The number of days in the range. */
export const dayCount = (report: UsageReport): number => report.runtimes[0]?.tokens.length ?? 0;

/** The date of each day of the range. */
export const daysOf = (report: UsageReport): Date[] => {
  const first = dateOf(report.start).getTime();
  return Array.from({ length: dayCount(report) }, (_, index) => new Date(first + index * 864e5));
};

/** The date of the day at `index` of the range. */
export const dayOf = (report: UsageReport, index: number): Date => {
  const day = daysOf(report)[index];
  if (!day)
    throw new Error(
      `The report has no day at index ${index}. Use an index from 0 to ${dayCount(report) - 1}.`,
    );
  return day;
};

/** The total of all runtimes on each day. */
export const dailyTotals = (report: UsageReport, metric: UsageMetric): number[] =>
  Array.from({ length: dayCount(report) }, (_, index) =>
    sum(report.runtimes.map((usage) => valuesOf(usage, metric)[index] ?? 0)),
  );

/** The other metric of a figure as a short detail: `$342.32` or `1.84B tokens`. */
const otherMetricText = (tokens: number, cost: number, metric: UsageMetric): string =>
  metric === "cost" ? `${formatCompactCount(tokens)} tokens` : formatUsd(cost);

/** The line under the total: the sessions and the other metric. */
export const summaryText = (report: UsageReport, metric: UsageMetric): string =>
  [
    formatCountOf(reportSessions(report), "session"),
    otherMetricText(reportTotal(report, "tokens"), reportTotal(report, "cost"), metric),
  ].join(" · ");

/**
 * One row of the By runtime list: its value and the parts of the line under it. Only a wide page
 * shows the noun after the share.
 */
export type RuntimeLine = {
  runtime: RuntimeKind;
  value: string;
  sessions: string;
  share: string;
  noun: string;
  other: string;
};

/** The value of a runtime, and its sessions, share, and other metric. */
export const runtimeLine = (
  report: UsageReport,
  usage: RuntimeUsage,
  metric: UsageMetric,
): RuntimeLine => {
  const value = runtimeTotal(usage, metric);
  return {
    runtime: usage.runtime,
    value: formatMetric(value, metric),
    sessions: formatCountOf(usage.sessions, "session"),
    share: formatShare(value / reportTotal(report, metric)),
    noun: ` of ${METRIC_TEXT[metric].noun}`,
    other: otherMetricText(runtimeTotal(usage, "tokens"), runtimeTotal(usage, "cost"), metric),
  };
};

/** The title of the trend chart: `Daily processed tokens`. */
export const chartTitle = (metric: UsageMetric): string =>
  `${DAY_TEXT.adjective} ${METRIC_TEXT[metric].trend}`;

/** The index of the day with the largest value: the first one on a tie. */
const busiestIndex = (values: readonly number[]): number =>
  values.reduce(
    (best, value, index) => (value > 0 && (best < 0 || value > (values[best] ?? 0)) ? index : best),
    -1,
  );

/** The value and the detail line of each Highlights tile in a metric. */
export type HighlightFigures = {
  cacheHit: { value: string; share: number; detail: string };
  busiest: { value: string; detail: string; index: number; values: number[] };
  average: { value: string; detail: string; active: boolean[] };
  perSession: { value: string; detail: string };
};

/** The Highlights tiles of usage-highlights.tsx, from usageHighlights of usage-report.ts. */
export const highlightFigures = (report: UsageReport, metric: UsageMetric): HighlightFigures => {
  const { input, cacheRead, cacheWrite } = report.tokenTypes;
  const inputSide = input + cacheRead + cacheWrite;
  const values = dailyTotals(report, metric);
  const busiest = busiestIndex(values);
  const total = reportTotal(report, metric);
  const sessions = reportSessions(report);
  const active = values.map((value) => value > 0);
  const day = daysOf(report)[busiest];
  const peak = values[busiest] ?? 0;
  const average = total / Math.max(1, values.length);
  return {
    cacheHit: {
      value: formatShare(cacheRead / inputSide),
      share: cacheRead / inputSide,
      detail: `${formatCompactCount(cacheRead)} of ${formatCompactCount(inputSide)} input tokens from cache`,
    },
    busiest: {
      value: formatMetric(peak, metric),
      detail: day ? formatDay(day) : `No ${DAY_TEXT.noun} with a value`,
      index: busiest,
      values,
    },
    average: {
      value: formatMetric(average, metric),
      detail: `${formatCount(active.filter(Boolean).length)} of ${formatCountOf(values.length, DAY_TEXT.noun)} active`,
      active,
    },
    perSession: {
      value: formatMetric(total / sessions, metric),
      detail: `Over ${formatCountOf(sessions, "active session")}`,
    },
  };
};

/** The height of a column of the busiest day as a share of the largest value. */
export const columnHeight = (value: number, max: number): string =>
  `${max === 0 ? 0 : (value / max) * 100}%`;

/** The values of one day for the chart tooltip: the total and each runtime with its share. */
export type DayFigures = {
  day: string;
  total: string;
  /** A day without usage has no shares. */
  rows: { runtime: RuntimeKind; share: string | null; value: string }[];
};

/** The tooltip of the trend chart for the day at `index`. */
export const dayFigures = (report: UsageReport, index: number, metric: UsageMetric): DayFigures => {
  const total = dailyTotals(report, metric)[index] ?? 0;
  return {
    day: formatDay(dayOf(report, index)),
    total: formatMetric(total, metric),
    rows: report.runtimes.map((usage) => {
      const value = valuesOf(usage, metric)[index] ?? 0;
      return {
        runtime: usage.runtime,
        share: total > 0 ? formatShare(value / total) : null,
        value: formatMetric(value, metric),
      };
    }),
  };
};
