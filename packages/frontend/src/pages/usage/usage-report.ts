import type { UsagePeriod, UsageReport } from "@openducktor/contracts";
import {
  figureGaps,
  gapsNote,
  missingReason,
  PERIOD_TEXT,
  periodTotal,
  reportRuntimes,
  shownValue,
  USAGE_RUNTIME_LABELS,
  type UsageMetric,
} from "./usage-format";

/** True when the report has sessions, tokens, or requests without token counts. */
export const hasActivity = (report: UsageReport): boolean =>
  report.totals.sessions > 0 || report.totals.tokens.processed > 0 || report.totals.unmeasured > 0;

/** The message of a report without activity. */
type EmptyState = { title: string; text: string };

/** Why a report shows no activity: no history, history that could not be read, or a quiet range. */
export const emptyStateOf = (report: UsageReport): EmptyState => {
  if (report.coverage.some((entry) => entry.state === "partial"))
    return {
      title: "No readable activity in this range",
      text: "Some history could not be read, so activity can be missing. Sources names the problem.",
    };
  if (report.coverage.every((entry) => entry.state === "no_history")) {
    const [only] = report.coverage;
    // A runtime filter returns the coverage of that runtime only.
    if (only && report.coverage.length === 1)
      return {
        title: `No ${USAGE_RUNTIME_LABELS[only.runtime]} history on this host`,
        text: `This host has no recorded ${USAGE_RUNTIME_LABELS[only.runtime]} sessions. Select another runtime.`,
      };
    return {
      title: "No runtime history on this host",
      text: "This host has no recorded Claude Code, Codex, or OpenCode sessions.",
    };
  }
  return { title: "No activity in this range", text: "Select another date range or runtime." };
};

/**
 * The figures of the Highlights tiles. A value is null when the tile shows a dash; `missing` then
 * gives the reason. `note` names what the values leave out.
 */
export type UsageHighlights = {
  cacheHit: {
    rate: number | null;
    missing: string;
    cacheRead: number;
    inputSide: number;
    note: string | null;
  };
  busiest: { value: number | null; missing: string; period: UsagePeriod | null; index: number };
  average: { value: number | null; missing: string; activeCount: number };
  perSession: { value: number | null; missing: string; sessions: number };
  /** The total of each period, in period order. */
  values: number[];
  note: string | null;
};

/** The index of the period with the largest value, or -1 without a value. */
const busiestIndex = (values: readonly number[]): number =>
  values.reduce(
    (best, value, index) => (value > 0 && (best < 0 || value > (values[best] ?? 0)) ? index : best),
    -1,
  );

/** Cache use, the busiest period, and the averages of a report in a metric. */
export const usageHighlights = (report: UsageReport, metric: UsageMetric): UsageHighlights => {
  const { totals, granularity } = report;
  const noun = PERIOD_TEXT[granularity].noun;
  const runtimes = reportRuntimes(report.byRuntime);
  const values = report.periods.map((period) => periodTotal(period, runtimes, metric).value);
  const total = shownValue(totals, metric);
  const missing = missingReason(totals, metric);

  const { input, cacheRead, cacheWrite } = totals.tokens;
  const inputSide = input + cacheRead + cacheWrite;
  const tokensMissing = missingReason(totals, "tokens");

  const busiest = busiestIndex(values);
  const activeCount = values.filter((value) => value > 0).length;
  return {
    cacheHit: {
      rate: tokensMissing === null && inputSide > 0 ? cacheRead / inputSide : null,
      missing: tokensMissing ?? "No input tokens in this range.",
      cacheRead,
      inputSide,
      note: gapsNote(figureGaps(totals, "tokens")),
    },
    busiest: {
      value: busiest < 0 ? null : (values[busiest] ?? 0),
      missing: `No ${noun} with a value.`,
      period: report.periods[busiest] ?? null,
      index: busiest,
    },
    average: {
      value: total === null || activeCount === 0 ? null : total / Math.max(1, values.length),
      missing: missing ?? `No ${noun} with a value.`,
      activeCount,
    },
    perSession: {
      value: total === null || totals.sessions === 0 ? null : total / totals.sessions,
      missing: missing ?? "No sessions in this range.",
      sessions: totals.sessions,
    },
    values,
    note: gapsNote(figureGaps(totals, metric)),
  };
};
