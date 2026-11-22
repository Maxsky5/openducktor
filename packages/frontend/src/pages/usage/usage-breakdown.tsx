import type { RuntimeKind, UsageFigure, UsageReport } from "@openducktor/contracts";
import { ChevronDown } from "lucide-react";
import { type ReactElement, type ReactNode, useState } from "react";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
import { Button } from "@/components/ui/button";
import { ToggleTabs, ToggleTabsItem } from "@/components/ui/toggle-tabs";
import { cn } from "@/lib/utils";
import {
  formatCount,
  formatCountOf,
  formatShare,
  endsToday,
  formatTableMetric,
  metricValue,
  periodName,
  providerName,
  shownValue,
  USAGE_RUNTIME_LABELS,
  type UsageMetric,
} from "./usage-format";
import { Explained, IncompleteMark, MetricValue, SectionHeading } from "./usage-parts";

type BreakdownView = "model" | "project" | "period";

const PERIOD_LABELS = {
  day: "Day",
  week: "Week",
  month: "Month",
} satisfies Record<UsageReport["granularity"], string>;

/** Rows shown before Show all. */
const COLLAPSED_ROWS = 10;

type RankedRow = { id: string; name: string; detail: string | null; figure: UsageFigure };

const byValue =
  (metric: UsageMetric) =>
  (left: RankedRow, right: RankedRow): number =>
    (shownValue(right.figure, metric) ?? -1) - (shownValue(left.figure, metric) ?? -1);

const HEAD = "h-9 px-3 align-middle text-xs font-medium text-muted-foreground";
const CELL = "h-12 px-3 tabular-nums";

/** Up to 10 rows, and a button that shows the rest. */
function useCollapsedRows<Row>(rows: readonly Row[]) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const toggle =
    rows.length > COLLAPSED_ROWS ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start text-muted-foreground"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "Show fewer" : `Show all ${formatCount(rows.length)}`}
        <ChevronDown
          className={cn("size-4 transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </Button>
    ) : null;
  return { shown, toggle };
}

/** A numeric column keeps one width, so columns stay in place when the metric changes. */
const NUMBER_HEAD = cn(HEAD, "w-20 whitespace-nowrap text-right @xl:w-24");

/** Shows a column of the other metric only in a wide page; a narrow page shows the selected one. */
const metricColumn = (column: UsageMetric, metric: UsageMetric): string =>
  column === metric ? "" : "hidden @xl:table-cell";

/** Models or projects, ranked by the selected metric, with their share of it. */
function RankedTable({
  rows,
  nameHeader,
  totals,
  metric,
}: {
  rows: readonly RankedRow[];
  nameHeader: string;
  totals: UsageFigure;
  metric: UsageMetric;
}): ReactElement {
  const ranked = rows.toSorted(byValue(metric));
  const { shown, toggle } = useCollapsedRows(ranked);
  const total = metricValue(totals, metric);
  const top = ranked[0] ? (shownValue(ranked[0].figure, metric) ?? 0) : 0;
  return (
    <>
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className={cn(HEAD, "hidden w-10 @md:table-cell")}>
              #
            </th>
            <th scope="col" className={HEAD}>
              {nameHeader}
            </th>
            <th scope="col" className={cn(NUMBER_HEAD, "hidden @2xl:table-cell")}>
              Sessions
            </th>
            <th scope="col" className={cn(NUMBER_HEAD, "hidden @xl:table-cell")}>
              % of {metric === "tokens" ? "tokens" : "cost"}
            </th>
            <th scope="col" className={cn(NUMBER_HEAD, metricColumn("cost", metric))}>
              Cost
            </th>
            <th scope="col" className={cn(NUMBER_HEAD, metricColumn("tokens", metric))}>
              Tokens
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => {
            const value = shownValue(row.figure, metric);
            const share = value === null || !total ? null : value / total;
            const barShare = top > 0 && value ? value / top : 0;
            const shareText = share === null ? "—" : formatShare(share);
            return (
              <tr key={row.id} className="border-b border-border/60 hover:bg-muted/40">
                <td className={cn(CELL, "hidden text-muted-foreground @md:table-cell")}>
                  {index + 1}
                </td>
                <td className={cn(CELL, "relative min-w-0")}>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate font-medium">{row.name}</span>
                      {row.detail ? (
                        // A narrow page keeps the width for the name.
                        <span className="hidden truncate text-xs text-muted-foreground @3xl:inline">
                          {row.detail}
                        </span>
                      ) : null}
                      <IncompleteMark figure={row.figure} />
                    </span>
                    {/* A narrower page shows the columns that it hides under the name. */}
                    <span className="text-xs text-muted-foreground @2xl:hidden">
                      {formatCountOf(row.figure.sessions, "session")}
                      <span className="@xl:hidden"> · {shareText}</span>
                    </span>
                  </div>
                  {/* The bar sits under the name, so the name stays centered in the row. A bar
                      under 1% of the top row would read as a stray dot. */}
                  {barShare >= 0.01 ? (
                    <span
                      className="absolute bottom-1.5 left-3 hidden h-0.5 w-[calc(100%-1.5rem)] max-w-64 @2xl:block"
                      aria-hidden="true"
                    >
                      <span
                        className="block h-full rounded-full bg-foreground/45"
                        style={{ width: `${barShare * 100}%` }}
                      />
                    </span>
                  ) : null}
                </td>
                <td className={cn(CELL, "hidden text-right text-muted-foreground @2xl:table-cell")}>
                  {formatCount(row.figure.sessions)}
                </td>
                <td className={cn(CELL, "hidden text-right text-muted-foreground @xl:table-cell")}>
                  {shareText}
                </td>
                <td
                  className={cn(
                    CELL,
                    "text-right",
                    metricColumn("cost", metric),
                    metric === "cost" && "font-medium",
                  )}
                >
                  <MetricValue figure={row.figure} metric="cost" exact />
                </td>
                <td
                  className={cn(
                    CELL,
                    "text-right",
                    metricColumn("tokens", metric),
                    metric === "tokens" && "font-medium",
                  )}
                >
                  <MetricValue figure={row.figure} metric="tokens" exact />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {toggle}
    </>
  );
}

/** The known total of figures, and whether a figure had no value or left part out. */
const sumOf = (figures: readonly UsageFigure[], metric: UsageMetric) => {
  let total = 0;
  let partial = false;
  for (const figure of figures) {
    const value = shownValue(figure, metric);
    if (value === null) partial = true;
    else total += value;
    if (!figure.complete) partial = true;
  }
  return { total, partial };
};

function SumCell({
  figures,
  metric,
  className,
}: {
  figures: readonly UsageFigure[];
  metric: UsageMetric;
  className?: string;
}): ReactElement {
  const { total, partial } = sumOf(figures, metric);
  return (
    <td className={cn(CELL, "relative text-right", className)}>
      {partial ? (
        <Explained text="Total of the known values. Some values are missing or partial.">
          {formatTableMetric(total, metric)}
          {/* The mark sits in the cell padding, so the digits of the column line up. */}
          <span className="absolute right-1 text-muted-foreground">*</span>
        </Explained>
      ) : (
        formatTableMetric(total, metric)
      )}
    </td>
  );
}

/** One row per period, newest first, with each runtime's value. */
function PeriodTable({
  report,
  runtimes,
  metric,
}: {
  report: UsageReport;
  runtimes: readonly RuntimeKind[];
  metric: UsageMetric;
}): ReactElement {
  const lastStart = report.periods.at(-1)?.start;
  const inProgress = endsToday(report);
  const periods = report.periods.toReversed();
  const { shown, toggle } = useCollapsedRows(periods);
  const other: UsageMetric = metric === "tokens" ? "cost" : "tokens";
  const periodLabel = PERIOD_LABELS[report.granularity];
  const anyPartial = periods.some(
    (period) =>
      sumOf(
        period.runtimes.map((entry) => entry.figure),
        metric,
      ).partial,
  );
  return (
    <>
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className={HEAD}>
              {periodLabel}
            </th>
            {runtimes.map((runtime) => (
              <th
                key={runtime}
                scope="col"
                className={cn(NUMBER_HEAD, "hidden @2xl:table-cell @2xl:w-32")}
              >
                <span className="inline-flex items-center gap-1.5 align-middle leading-none">
                  <AgentRuntimeIcon runtimeKind={runtime} className="size-3.5" />
                  {USAGE_RUNTIME_LABELS[runtime]}
                </span>
              </th>
            ))}
            <th scope="col" className={NUMBER_HEAD}>
              Total
            </th>
            <th scope="col" className={NUMBER_HEAD}>
              {other === "tokens" ? "Tokens" : "Cost"}
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((period) => {
            const figures = period.runtimes.map((entry) => entry.figure);
            return (
              <tr key={period.start} className="border-b border-border/60 hover:bg-muted/40">
                <td className={cn(CELL, "whitespace-nowrap")}>
                  {periodName(period, report.granularity)}
                  {inProgress && period.start === lastStart ? (
                    <span className="ml-1.5 text-xs text-muted-foreground">so far</span>
                  ) : null}
                </td>
                {runtimes.map((runtime) => {
                  const figure = period.runtimes.find((entry) => entry.runtime === runtime)?.figure;
                  return (
                    <td
                      key={runtime}
                      className={cn(
                        CELL,
                        "hidden text-right text-muted-foreground @2xl:table-cell",
                      )}
                    >
                      {figure ? (
                        <MetricValue figure={figure} metric={metric} exact />
                      ) : (
                        formatTableMetric(0, metric)
                      )}
                    </td>
                  );
                })}
                <SumCell figures={figures} metric={metric} className="font-medium" />
                <SumCell figures={figures} metric={other} className="text-muted-foreground" />
              </tr>
            );
          })}
        </tbody>
      </table>
      {toggle}
      {anyPartial ? (
        <p className="px-3 pt-2 text-xs text-muted-foreground">
          * Leaves out{" "}
          {metric === "tokens" ? "requests without token counts" : "usage without a published rate"}{" "}
          (—) and history that could not be read.
        </p>
      ) : null}
    </>
  );
}

const modelRows = (report: UsageReport): RankedRow[] =>
  report.byModel.map((row) => ({
    id: row.id,
    name: row.model ?? "Unknown model",
    detail: row.provider === null ? null : providerName(row.provider),
    figure: row.figure,
  }));

const projectRows = (report: UsageReport): RankedRow[] =>
  report.byProject.map((row) => ({
    id: row.id,
    name: row.label ?? "Unknown project",
    detail: null,
    figure: row.figure,
  }));

/** Models, projects, or periods of the report in one table. */
export function UsageBreakdown({
  report,
  runtimes,
  metric,
}: {
  report: UsageReport;
  runtimes: readonly RuntimeKind[];
  metric: UsageMetric;
}): ReactElement {
  const [view, setView] = useState<BreakdownView>("model");
  let table: ReactNode;
  if (view === "model")
    table = (
      <RankedTable
        rows={modelRows(report)}
        nameHeader="Model"
        totals={report.totals}
        metric={metric}
      />
    );
  else if (view === "project")
    table = (
      <RankedTable
        rows={projectRows(report)}
        nameHeader="Project"
        totals={report.totals}
        metric={metric}
      />
    );
  else table = <PeriodTable report={report} runtimes={runtimes} metric={metric} />;
  return (
    <section aria-labelledby="usage-breakdown" className="flex flex-col gap-2">
      <SectionHeading
        id="usage-breakdown"
        title="Breakdown"
        action={
          <ToggleTabs
            aria-label="Breakdown by"
            value={view}
            onValueChange={setView}
            // A narrow page gives the views a full-width row, as the ranges have.
            className="grid w-full grid-cols-3 @lg:inline-flex @lg:w-fit"
          >
            <ToggleTabsItem value="model">Model</ToggleTabsItem>
            <ToggleTabsItem value="project">Project</ToggleTabsItem>
            <ToggleTabsItem value="period">{PERIOD_LABELS[report.granularity]}</ToggleTabsItem>
          </ToggleTabs>
        }
      />
      {/* A narrow window scrolls the table sideways instead of squeezing its columns. */}
      <div className="flex flex-col overflow-x-auto">{table}</div>
    </section>
  );
}
