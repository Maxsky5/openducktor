import type { RuntimeKind, UsageFigure, UsageReport } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
import {
  endsToday,
  formatCompactCount,
  formatCountOf,
  formatShare,
  formatUsd,
  leftOutNote,
  metricValue,
  USAGE_RUNTIME_LABELS,
  type UsageMetric,
} from "./usage-format";
import { IncompleteMark, MetricValue, RuntimeDot } from "./usage-parts";
import { UsageTrendChart } from "./usage-trend-chart";

const PERIOD_ADJECTIVES = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
} satisfies Record<UsageReport["granularity"], string>;

/** The other metric of a figure, as a short detail: `$1,204` or `59.8B tokens`. */
const otherMetricText = (figure: UsageFigure, metric: UsageMetric): string | null => {
  if (metric === "cost") {
    const tokens = metricValue(figure, "tokens");
    return tokens === null ? null : `${formatCompactCount(tokens)} tokens`;
  }
  const cost = metricValue(figure, "cost");
  return cost === null || figure.cost.state === "none" ? null : formatUsd(cost);
};

const shareOf = (figure: UsageFigure, totals: UsageFigure, metric: UsageMetric) => {
  const value = metricValue(figure, metric);
  const total = metricValue(totals, metric);
  if (value === null || total === null || total === 0) return null;
  return formatShare(value / total);
};

function RuntimeRow({
  runtime,
  figure,
  totals,
  metric,
}: {
  runtime: RuntimeKind;
  figure: UsageFigure;
  totals: UsageFigure;
  metric: UsageMetric;
}): ReactElement {
  const share = shareOf(figure, totals, metric);
  const other = otherMetricText(figure, metric);
  return (
    <li className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <RuntimeDot runtime={runtime} />
        <AgentRuntimeIcon runtimeKind={runtime} className="size-4 shrink-0" />
        <span className="truncate text-sm font-medium">{USAGE_RUNTIME_LABELS[runtime]}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-sm font-semibold tabular-nums">
          <IncompleteMark figure={figure} />
          <MetricValue figure={figure} metric={metric} />
        </span>
      </div>
      {/* Each part keeps one line. A separator ends the part before it, so a wrapped line
          never starts with one. */}
      <span className="flex flex-wrap gap-x-1 pl-4 text-xs text-muted-foreground">
        <span className="whitespace-nowrap">
          {formatCountOf(figure.sessions, "session")}
          {share || other ? " ·" : null}
        </span>
        {share ? (
          <span className="whitespace-nowrap">
            {share}
            {/* Only the wide single column has room for the noun. */}
            <span className="hidden @4xl:inline">
              {" "}
              of {metric === "tokens" ? "tokens" : "cost"}
            </span>
            {other ? " ·" : null}
          </span>
        ) : null}
        {other ? <span className="whitespace-nowrap">{other}</span> : null}
      </span>
    </li>
  );
}

/** The total of the range, each runtime's part of it, and the trend. */
export function UsageOverview({
  report,
  runtimes,
  metric,
}: {
  report: UsageReport;
  runtimes: readonly RuntimeKind[];
  metric: UsageMetric;
}): ReactElement {
  const { totals } = report;
  const summary = [formatCountOf(totals.sessions, "session"), otherMetricText(totals, metric)];
  const note = leftOutNote(totals, metric);
  const chartTitle = `${PERIOD_ADJECTIVES[report.granularity]} ${metric === "tokens" ? "processed tokens" : "estimated cost"}`;
  return (
    <section
      aria-label="Overview"
      className="grid grid-cols-1 gap-x-12 gap-y-8 @4xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]"
    >
      <div className="flex min-w-0 flex-col gap-7">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {metric === "tokens" ? "Processed tokens" : "Estimated API cost"}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-5xl font-semibold tracking-tight tabular-nums">
              <MetricValue figure={totals} metric={metric} />
            </span>
            <IncompleteMark figure={totals} />
          </div>
          <span className="text-sm text-muted-foreground">
            {summary.filter((part) => part !== null).join(" · ")}
          </span>
          {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
        </div>
        {/* Above the chart, the runtimes take one column each, near their values. */}
        <ul
          aria-label="By runtime"
          className="grid grid-cols-1 gap-x-8 gap-y-4 @3xl:grid-cols-3 @4xl:grid-cols-1"
        >
          {runtimes.map((runtime) => {
            const figure = report.byRuntime.find((row) => row.runtime === runtime)?.figure;
            return figure ? (
              <RuntimeRow
                key={runtime}
                runtime={runtime}
                figure={figure}
                totals={totals}
                metric={metric}
              />
            ) : null;
          })}
        </ul>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{chartTitle}</h2>
          {runtimes.length > 1 ? (
            // The runtime list is the legend of the bands; the total line needs its own.
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-0.5 w-3 rounded-full bg-foreground" aria-hidden="true" />
              Total
            </span>
          ) : null}
        </div>
        <UsageTrendChart
          periods={report.periods}
          granularity={report.granularity}
          runtimes={runtimes}
          metric={metric}
          inProgress={endsToday(report)}
        />
      </div>
    </section>
  );
}
