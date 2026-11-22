import {
  USAGE_FIRST_DATE,
  USAGE_LAST_DATE,
  type RuntimeKind,
  type UsageRangeInput,
  type UsageReport,
} from "@openducktor/contracts";
import { describeRemoteConnectionFailure } from "@openducktor/frontend-core/lib/remote-connection-failure";
import { usageReportQueryOptions } from "@openducktor/frontend-core/queries/usage";
import { RemoteConnectionError } from "@openducktor/host-client/remote";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { LoaderCircle, ServerOff, TriangleAlert } from "lucide-react";
import { memo, type ReactElement, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { UsageBreakdown } from "./usage-breakdown";
import { UsageCoverage } from "./usage-coverage";
import { UsageFirstRead } from "./usage-first-read";
import {
  MetricTabs,
  RangeTabs,
  type RangeKind,
  RefreshButton,
  RuntimeFilter,
} from "./usage-filters";
import {
  formatDate,
  formatRange,
  formatTime,
  reportRuntimes,
  USAGE_RUNTIME_LABELS,
  type UsageMetric,
} from "./usage-format";
import { UsagePageFrame } from "./usage-layout";
import { UsageHighlights } from "./usage-highlights";
import { UsageOverview } from "./usage-overview";
import { UsagePageSkeleton } from "./usage-page-skeleton";
import { UsageTokenTypes } from "./usage-token-types";
import { type UsageProgressState, useUsageProgress } from "./use-usage-progress";

/** A host without Usage refuses the command it does not know. */
const isUsageUnavailable = (error: Error | null): boolean =>
  error instanceof RemoteConnectionError && error.failure.code === "function_unavailable";

/** The reason of a failed read and, when the host gives one, what to do next. */
const errorText = (error: Error | null): string => {
  if (!error) return "The usage read failed.";
  const { message, nextAction } = describeRemoteConnectionFailure(error);
  return nextAction ? `${message} ${nextAction}` : message;
};

function CustomRangeForm({
  initial,
  onApply,
}: {
  initial: { start: string; end: string };
  onApply: (range: UsageRangeInput) => void;
}): ReactElement {
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (!start || !end) {
      setProblem("Enter a start date and an end date.");
      return;
    }
    if ([start, end].some((date) => date < USAGE_FIRST_DATE || date > USAGE_LAST_DATE)) {
      setProblem(
        `Use dates from ${formatDate(USAGE_FIRST_DATE)} to ${formatDate(USAGE_LAST_DATE)}.`,
      );
      return;
    }
    if (end < start) {
      setProblem("The end date must be on or after the start date.");
      return;
    }
    setProblem(null);
    onApply({ kind: "custom", start, end });
  };
  return (
    // A narrow window puts both dates side by side and Apply under them.
    <form
      onSubmit={submit}
      className="grid grid-cols-2 items-end gap-2 @md:flex @md:flex-wrap"
      noValidate
    >
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        From
        <Input
          type="date"
          value={start}
          min={USAGE_FIRST_DATE}
          max={USAGE_LAST_DATE}
          onChange={(event) => setStart(event.target.value)}
          className="h-9 w-full @md:w-40"
          aria-invalid={problem !== null}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        To
        <Input
          type="date"
          value={end}
          min={USAGE_FIRST_DATE}
          max={USAGE_LAST_DATE}
          onChange={(event) => setEnd(event.target.value)}
          className="h-9 w-full @md:w-40"
          aria-invalid={problem !== null}
        />
      </label>
      <Button type="submit" variant="secondary" className="col-span-2 h-9 @md:col-span-1">
        Apply
      </Button>
      {problem ? (
        <p role="alert" className="col-span-2 basis-full text-xs text-destructive-muted">
          {problem}
        </p>
      ) : null}
    </form>
  );
}

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

/** Why a report shows no activity: no history, history that could not be read, or a quiet range. */
type EmptyState = { title: string; text: string };

const emptyStateOf = (report: UsageReport): EmptyState => {
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

const hasActivity = (report: UsageReport): boolean =>
  report.totals.sessions > 0 || report.totals.tokens.processed > 0 || report.totals.unmeasured > 0;

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

function UsageResult({
  report,
  error,
  progress,
  metric,
  onRetry,
}: {
  report: UsageReport | undefined;
  error: Error | null;
  progress: UsageProgressState | null;
  metric: UsageMetric;
  onRetry: () => void;
}): ReactElement {
  if (report) return <UsageReportView report={report} metric={metric} />;
  if (isUsageUnavailable(error))
    return (
      <UsageMessage icon={<ServerOff className="size-5" />} title="This host does not have Usage">
        Update OpenDucktor on the host, then open Usage again.
      </UsageMessage>
    );
  if (error)
    return (
      <UsageMessage
        icon={<TriangleAlert className="size-5" />}
        title="Usage could not be read"
        action={
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        }
      >
        {errorText(error)}
      </UsageMessage>
    );
  // A read that parses new history reports its progress; a fast read shows the skeleton only.
  return progress ? <UsageFirstRead state={progress} /> : <UsagePageSkeleton />;
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
  if (state.progress.phase === "summarizing") return "Building the daily totals…";
  return `Reading new history · ${Math.floor(state.share * 100)}%`;
};

/** Usage of every Claude Code, Codex, and OpenCode session on the selected host. */
export function UsagePage(): ReactElement {
  const [range, setRange] = useState<UsageRangeInput>({ kind: "last_30_days" });
  const [rangeKind, setRangeKind] = useState<RangeKind>("last_30_days");
  const [runtime, setRuntime] = useState<RuntimeKind | null>(null);
  const [metric, setMetric] = useState<UsageMetric>("tokens");
  // A new selection keeps the shown result, marked as loading, until its own result arrives,
  // so the page never falls back to the skeleton between two results.
  const query = useQuery({
    ...usageReportQueryOptions({ range, runtime }),
    placeholderData: keepPreviousData,
  });
  const loadingSelection = query.isPlaceholderData && query.isFetching;
  // A failed read of a new selection shows its error, not the result of another selection.
  const report = query.isPlaceholderData && !query.isFetching ? undefined : query.data;
  const progress = useUsageProgress(query.isFetching);
  const refetch = () => void query.refetch();
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
            progress={progress}
            updatedText={updatedText}
          />
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <RangeTabs rangeKind={rangeKind} onRangeKind={chooseRange} />
          <MetricTabs metric={metric} onMetric={setMetric} />
          <RefreshButton
            fetching={query.isFetching}
            disabled={query.isFetching || (!report && isUsageUnavailable(query.error))}
            updatedText={updatedText}
            onRefresh={refetch}
          />
        </div>
      </header>
      {rangeKind === "custom" ? (
        // The form keeps its draft while filters change and reads run; it starts from the
        // applied range when the user opens it.
        <CustomRangeForm initial={customRangeOf(range, report)} onApply={setRange} />
      ) : null}
      {report && query.isError ? (
        <StaleResultAlert report={report} error={query.error} onRetry={refetch} />
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
        <UsageResult
          report={report}
          error={query.error}
          progress={progress}
          metric={metric}
          onRetry={refetch}
        />
      </div>
    </UsagePageFrame>
  );
}

export default UsagePage;
