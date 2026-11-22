import type { RuntimeKind, UsageRangeInput, UsageReport } from "@openducktor/contracts";
import { describeRemoteConnectionFailure } from "@openducktor/frontend-core/lib/remote-connection-failure";
import { LoaderCircle, ServerOff, TriangleAlert } from "lucide-react";
import { memo, type ReactElement, type ReactNode, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UsageBreakdown } from "./usage-breakdown";
import { UsageCoverage } from "./usage-coverage";
import { UsageFirstRead } from "./usage-first-read";
import {
  CustomRangeForm,
  MetricTabs,
  RangeTabs,
  type RangeKind,
  RefreshButton,
  RuntimeFilter,
} from "./usage-filters";
import { formatRange, formatTime, reportRuntimes, type UsageMetric } from "./usage-format";
import { UsagePageFrame } from "./usage-layout";
import { UsageHighlights } from "./usage-highlights";
import { UsageOverview } from "./usage-overview";
import { UsagePageSkeleton } from "./usage-page-skeleton";
import { emptyStateOf, hasActivity } from "./usage-report";
import { UsageTokenTypes } from "./usage-token-types";
import { useSkeletonHold } from "./use-skeleton-hold";
import type { UsageProgressState } from "./use-usage-progress";
import { type UsageReportState, useUsageReport } from "./use-usage-report";

/** The reason of a failed read and, when the host gives one, what to do next. */
const errorText = (error: Error | null): string => {
  if (!error) return "The usage read failed.";
  const { message, nextAction } = describeRemoteConnectionFailure(error);
  return nextAction ? `${message} ${nextAction}` : message;
};

function UsageMessage({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactElement;
  title: string;
  children: ReactElement | string;
  action?: ReactElement;
}): ReactElement {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-16 text-center"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="flex max-w-md flex-col gap-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * The report sections. A fetch that only changes the fetch state of the page does not render them
 * again: the query keeps the same report object until a new result arrives.
 */
const UsageReportView = memo(function UsageReportView({
  report,
  metric,
}: {
  report: UsageReport;
  metric: UsageMetric;
}): ReactElement {
  // A refresh with the same runtimes keeps the chart definition.
  const { byRuntime } = report;
  const runtimes = useMemo(() => reportRuntimes(byRuntime), [byRuntime]);
  if (!hasActivity(report)) {
    const { title, text } = emptyStateOf(report);
    return (
      <div className="flex flex-col gap-10">
        <UsageMessage icon={<ServerOff className="size-5" />} title={title}>
          {text}
        </UsageMessage>
        <UsageCoverage report={report} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-12">
      <UsageOverview report={report} runtimes={runtimes} metric={metric} />
      <UsageHighlights report={report} metric={metric} />
      <UsageTokenTypes figure={report.totals} />
      <UsageBreakdown report={report} runtimes={runtimes} metric={metric} />
      <UsageCoverage report={report} />
    </div>
  );
});

/** A failed refresh keeps the last result of the same selection and marks it stale. */
function StaleResultAlert({
  report,
  error,
  onRetry,
}: {
  report: UsageReport;
  error: Error | null;
  onRetry: () => void;
}): ReactElement {
  return (
    <Alert variant="warning" className="flex-wrap items-center px-4 py-3 [&>svg]:mt-0">
      <TriangleAlert aria-hidden="true" />
      <AlertDescription className="flex-1">
        Showing the result from {formatTime(report.resultAt)}. The refresh failed:{" "}
        {errorText(error)}
      </AlertDescription>
      <Button type="button" size="sm" variant="warning" onClick={onRetry}>
        Retry
      </Button>
    </Alert>
  );
}

/** What replaces the skeleton fades in. A key change, such as an error after the card, fades again. */
function Reveal({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="motion-safe:animate-[usage-enter_320ms_var(--motion-ease-out)]">{children}</div>
  );
}

function UsageResult({
  state,
  metric,
}: {
  state: UsageReportState;
  metric: UsageMetric;
}): ReactElement {
  const { report, error, progress } = state;
  // Without data, the skeleton shows at once and stays for at least half a second.
  const skeleton = useSkeletonHold(report === undefined && error === null && progress === null);
  if (skeleton) return <UsagePageSkeleton />;
  if (report)
    return (
      <Reveal key="report">
        <UsageReportView report={report} metric={metric} />
      </Reveal>
    );
  if (state.unavailable)
    return (
      <Reveal key="unavailable">
        <UsageMessage icon={<ServerOff className="size-5" />} title="This host does not have Usage">
          Update OpenDucktor on the host, then open Usage again.
        </UsageMessage>
      </Reveal>
    );
  if (error)
    return (
      <Reveal key="error">
        <UsageMessage
          icon={<TriangleAlert className="size-5" />}
          title="Usage could not be read"
          action={
            <Button type="button" variant="outline" size="sm" onClick={state.refetch}>
              Retry
            </Button>
          }
        >
          {errorText(error)}
        </UsageMessage>
      </Reveal>
    );
  // A read that parses new history reports its progress.
  return progress ? (
    <Reveal key="progress">
      <UsageFirstRead state={progress} />
    </Reveal>
  ) : (
    <UsagePageSkeleton />
  );
}

/** The dates that the custom range form starts with. */
const customRangeOf = (range: UsageRangeInput, report: UsageReport | undefined) => {
  if (range.kind === "custom") return { start: range.start, end: range.end };
  return report ? report.range : { start: "", end: "" };
};

/** The dates and time of the shown result, or a loading line while another selection loads. */
function ResultLine({
  report,
  loading,
  progress,
  updatedText,
}: {
  report: UsageReport | undefined;
  loading: boolean;
  progress: UsageProgressState | null;
  updatedText: string | null;
}): ReactElement | null {
  if (loading || (report && progress))
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        {progressText(progress) ?? "Loading the selected usage…"}
      </p>
    );
  if (!report) return null;
  return (
    <p className="text-xs text-muted-foreground" title={`Dates in ${report.timeZone}`}>
      <span className="whitespace-nowrap">{formatRange(report.range.start, report.range.end)}</span>
      {updatedText ? <span className="whitespace-nowrap"> · {updatedText}</span> : null}
    </p>
  );
}

/** A short line of the parse work while a shown result waits for new history. */
const progressText = (state: UsageProgressState | null): string | null => {
  if (!state) return null;
  if (state.summarizing) return "Building the daily totals…";
  return `Reading new history · ${Math.floor(state.share * 100)}%`;
};

/** Usage of every Claude Code, Codex, and OpenCode session on the selected host. */
export function UsagePage(): ReactElement {
  const [range, setRange] = useState<UsageRangeInput>({ kind: "last_30_days" });
  const [rangeKind, setRangeKind] = useState<RangeKind>("last_30_days");
  const [runtime, setRuntime] = useState<RuntimeKind | null>(null);
  const [metric, setMetric] = useState<UsageMetric>("tokens");
  const usage = useUsageReport({ range, runtime });
  const { report, loadingSelection, fetching } = usage;
  const chooseRange = (kind: RangeKind) => {
    setRangeKind(kind);
    if (kind !== "custom") setRange({ kind });
  };
  const updatedText = report ? `Updated ${formatTime(report.resultAt)}` : null;

  return (
    <UsagePageFrame>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">Usage</h1>
            <span className="text-muted-foreground/60" aria-hidden="true">
              /
            </span>
            <RuntimeFilter runtime={runtime} onRuntime={setRuntime} />
          </div>
          <ResultLine
            report={report}
            loading={loadingSelection}
            progress={usage.progress}
            updatedText={updatedText}
          />
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <RangeTabs rangeKind={rangeKind} onRangeKind={chooseRange} />
          <MetricTabs metric={metric} onMetric={setMetric} />
          <RefreshButton
            fetching={fetching}
            disabled={fetching || (!report && usage.unavailable)}
            updatedText={updatedText}
            onRefresh={usage.refetch}
          />
        </div>
      </header>
      {rangeKind === "custom" ? (
        // The form keeps its draft while filters change and reads run; it starts from the
        // applied range when the user opens it.
        <CustomRangeForm initial={customRangeOf(range, report)} onApply={setRange} />
      ) : null}
      {report && usage.error ? (
        <StaleResultAlert report={report} error={usage.error} onRetry={usage.refetch} />
      ) : null}
      {/* The previous result dims while the next one loads. The delay keeps a fast read from
          flashing. */}
      <div
        aria-busy={loadingSelection}
        className={cn(
          "transition-opacity duration-200",
          loadingSelection ? "pointer-events-none opacity-50 delay-150" : "opacity-100",
        )}
      >
        <UsageResult state={usage} metric={metric} />
      </div>
    </UsagePageFrame>
  );
}

export default UsagePage;
