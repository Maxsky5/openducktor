import type {
  RuntimeKind,
  UsageCoverageIssue,
  UsageGranularity,
  UsageReport,
  UsageRuntimeCoverage,
} from "@openducktor/contracts";
import { addDays, createUsageCalendar, type UsageCalendar, type UsageDate } from "./usage-calendar";
import { addUsageSums, EMPTY_USAGE_SUMS, type UsageSums, usageFigure } from "./usage-figure";
import { type UsageProjectGroup, usageProjectLabels } from "./usage-projects";

export type UsageSourceIssue = {
  code: UsageCoverageIssue["code"];
  firstAtMs: number | null;
  lastAtMs: number | null;
};

/**
 * A coverage issue of a runtime. A `source` issue belongs to one file or database. A `location`
 * issue says that the host cannot read some history folders or files of the runtime; it has no
 * dates, so it covers every date.
 */
export type UsageIssueRow = UsageSourceIssue & {
  runtime: RuntimeKind;
  scope: "source" | "location";
};

type UsageSumRow = UsageSums & { runtime: RuntimeKind };

/** The sums of one selection by runtime, period, model, and project group. */
export type UsageAggregate = {
  byRuntime: UsageSumRow[];
  /** `period` is the index of the period in `UsageIndexFigures.periodBounds`. */
  periods: (UsageSumRow & { period: number })[];
  byModel: (UsageSumRow & { provider: string | null; model: string | null })[];
  byProject: (UsageSums & { group: string })[];
};

/** The source check and the figures of one read of the usage index. */
export type UsageIndexFigures = UsageAggregate & {
  resultAtMs: number;
  range: { start: UsageDate; end: UsageDate };
  granularity: UsageGranularity;
  /** The periods of the range. `periods` holds their sums. */
  periodBounds: { start: UsageDate; end: UsageDate }[];
  /** Runtimes whose history location holds no source. It is no problem of the read. */
  withoutHistory: RuntimeKind[];
  issues: UsageIssueRow[];
  projects: UsageProjectGroup[];
  /**
   * The rate catalog of the costs: its source, when the host downloaded it, and why its last
   * download failed while the rates are missing or old.
   */
  pricing: { source: string; updatedAtMs: number | null; failure: string | null };
};

const RUNTIME_NAMES = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
} satisfies Record<RuntimeKind, string>;

/** A stable ID of a text that does not show the text: two 32-bit FNV-1a hashes. */
const usageStableId = (text: string): string => {
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x811c9dc5);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
};

/** Instants `[start, end)` of a date range. */
type Span = { startMs: number; endMs: number };

const spanOf = (calendar: UsageCalendar, start: UsageDate, end: UsageDate): Span => ({
  startMs: calendar.startOf(start),
  endMs: calendar.startOf(addDays(end, 1)),
});

/** An issue without known dates covers every date. */
const overlaps = (issue: UsageIssueRow, span: Span): boolean =>
  issue.firstAtMs === null ||
  issue.lastAtMs === null ||
  (issue.firstAtMs < span.endMs && issue.lastAtMs >= span.startMs);

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const coverageIssues = (
  runtime: RuntimeKind,
  issues: readonly UsageIssueRow[],
): UsageCoverageIssue[] => {
  const name = RUNTIME_NAMES[runtime];
  const result: UsageCoverageIssue[] = [];
  if (issues.some((issue) => issue.scope === "location"))
    result.push({
      code: "unreadable",
      message: `OpenDucktor cannot read some ${name} history folders or files. Usage shows the history that it can read.`,
      nextAction: `Give your user account read access to the ${name} history folders, then select Refresh.`,
    });
  const count = (code: UsageIssueRow["code"]) =>
    issues.filter((issue) => issue.scope === "source" && issue.code === code).length;
  const unreadable = count("unreadable");
  if (unreadable > 0)
    result.push({
      code: "unreadable",
      message: `OpenDucktor cannot read ${plural(unreadable, "file")} of the ${name} history.`,
      nextAction: `Give your user account read access to the ${name} history files, then select Refresh.`,
    });
  const malformed = count("malformed_records");
  if (malformed > 0)
    result.push({
      code: "malformed_records",
      message: `${plural(malformed, "file")} of the ${name} history ${malformed === 1 ? "has" : "have"} records that OpenDucktor cannot parse or attribute to one session. The figures leave those records out.`,
      nextAction: null,
    });
  if (count("unsupported_format") > 0)
    result.push({
      code: "unsupported_format",
      message: `${name} stores its history in a format that this OpenDucktor version cannot read.`,
      nextAction: "Update OpenDucktor, then select Refresh.",
    });
  return result;
};

/** Why the costs use no rates or old rates, with the action that fixes it. */
const pricingIssue = ({ source, updatedAtMs, failure }: UsageIndexFigures["pricing"]) =>
  failure === null
    ? null
    : `Usage could not ${updatedAtMs === null ? "load" : "update"} the API rates from ${source}: ${failure} Check the network access of the host, then refresh.`;

const sumOf = (rows: readonly UsageSumRow[]): UsageSums =>
  rows.reduce<UsageSums>(
    (total, { runtime: _runtime, ...row }) => addUsageSums(total, row),
    EMPTY_USAGE_SUMS,
  );

const byProcessed = <
  Row extends { figure: { tokens: { processed: number }; cost: { usd: number } } },
>(
  left: Row,
  right: Row,
) =>
  right.figure.tokens.processed - left.figure.tokens.processed ||
  right.figure.cost.usd - left.figure.cost.usd;

/**
 * Builds the report of the selected runtimes from the figures of one index read. A figure is
 * complete when no coverage issue of its runtimes overlaps its dates. Paths stay out of it.
 */
export const usageReport = ({
  timeZone,
  runtimes,
  figures,
}: {
  timeZone: string;
  runtimes: readonly RuntimeKind[];
  figures: UsageIndexFigures;
}): UsageReport => {
  const calendar = createUsageCalendar(timeZone);
  const { start, end } = figures.range;
  const rangeSpan = spanOf(calendar, start, end);
  const issuesOf = (runtime: RuntimeKind, span: Span) =>
    figures.issues.filter((issue) => issue.runtime === runtime && overlaps(issue, span));
  const completeIn = (runtime: RuntimeKind, span: Span) => issuesOf(runtime, span).length === 0;
  const rangeComplete = new Map(
    runtimes.map((runtime) => [runtime, completeIn(runtime, rangeSpan)]),
  );
  const allComplete = runtimes.every((runtime) => rangeComplete.get(runtime));

  const runtimeSums = new Map(figures.byRuntime.map(({ runtime, ...sums }) => [runtime, sums]));
  const byRuntime = runtimes.map((runtime) => ({
    runtime,
    figure: usageFigure(
      runtimeSums.get(runtime) ?? EMPTY_USAGE_SUMS,
      rangeComplete.get(runtime) ?? true,
    ),
  }));

  const periodSums = new Map<string, UsageSums>();
  for (const { period, runtime, ...sums } of figures.periods)
    periodSums.set(`${period}:${runtime}`, sums);
  const periods = figures.periodBounds.map((period, index) => {
    const span = spanOf(calendar, period.start, period.end);
    return {
      start: period.start,
      end: period.end,
      runtimes: runtimes.map((runtime) => ({
        runtime,
        figure: usageFigure(
          periodSums.get(`${index}:${runtime}`) ?? EMPTY_USAGE_SUMS,
          completeIn(runtime, span),
        ),
      })),
    };
  });

  // One model counts once across the runtimes that used it.
  const models = new Map<
    string,
    { provider: string | null; model: string | null; rows: UsageSumRow[] }
  >();
  for (const row of figures.byModel) {
    const key = `${row.provider ?? ""}\u0000${row.model ?? ""}`;
    const entry = models.get(key) ?? { provider: row.provider, model: row.model, rows: [] };
    entry.rows.push(row);
    models.set(key, entry);
  }
  const byModel = [...models.entries()]
    .map(([key, entry]) => ({
      id: usageStableId(key),
      provider: entry.provider,
      model: entry.model,
      figure: usageFigure(
        sumOf(entry.rows),
        entry.rows.every((row) => rangeComplete.get(row.runtime)),
      ),
    }))
    .sort(byProcessed);

  const labels = usageProjectLabels(figures.projects);
  const byProject = figures.byProject
    .map(({ group, ...sums }) => {
      const label = labels.get(group);
      if (label === undefined) throw new Error(`The project group ${group} has no label.`);
      return { id: usageStableId(group), label, figure: usageFigure(sums, allComplete) };
    })
    .sort(byProcessed);

  const coverage = runtimes.map((runtime): UsageRuntimeCoverage => {
    const issues = coverageIssues(runtime, issuesOf(runtime, rangeSpan));
    return {
      runtime,
      state:
        issues.length > 0
          ? "partial"
          : figures.withoutHistory.includes(runtime)
            ? "no_history"
            : "complete",
      issues,
    };
  });

  return {
    timeZone,
    range: { start, end },
    granularity: figures.granularity,
    resultAt: new Date(figures.resultAtMs).toISOString(),
    pricing: {
      source: figures.pricing.source,
      updatedAt:
        figures.pricing.updatedAtMs === null
          ? null
          : new Date(figures.pricing.updatedAtMs).toISOString(),
      issue: pricingIssue(figures.pricing),
    },
    totals: usageFigure(sumOf(figures.byRuntime), allComplete),
    periods,
    byRuntime,
    byModel,
    byProject,
    coverage,
  };
};
