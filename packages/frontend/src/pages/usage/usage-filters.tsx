import {
  USAGE_FIRST_DATE,
  USAGE_LAST_DATE,
  type RuntimeKind,
  type UsageRangeInput,
} from "@openducktor/contracts";
import { ChevronDown, Layers, RefreshCw } from "lucide-react";
import { type ReactElement, useState } from "react";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { ToggleTabs, ToggleTabsItem } from "@/components/ui/toggle-tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  formatDate,
  METRIC_TEXT,
  USAGE_RUNTIME_LABELS,
  USAGE_RUNTIMES,
  type UsageMetric,
} from "./usage-format";

export type RangeKind = UsageRangeInput["kind"];

/** A narrow page shows the short labels, so the range tabs fit on one line. */
const RANGE_OPTIONS: { kind: RangeKind; label: string; short: string }[] = [
  { kind: "last_7_days", label: "7 days", short: "7d" },
  { kind: "last_30_days", label: "30 days", short: "30d" },
  { kind: "last_90_days", label: "90 days", short: "90d" },
  { kind: "all_time", label: "All time", short: "All" },
  { kind: "custom", label: "Custom", short: "Custom" },
];

const ALL_RUNTIMES = "all";

const RUNTIME_OPTIONS: ComboboxOption[] = [
  {
    value: ALL_RUNTIMES,
    label: "All runtimes",
    icon: <Layers className="size-4 text-muted-foreground" />,
  },
  ...USAGE_RUNTIMES.map((runtime) => ({
    value: runtime,
    label: USAGE_RUNTIME_LABELS[runtime],
    icon: <AgentRuntimeIcon runtimeKind={runtime} className="size-4" />,
  })),
];

/** The runtime of the report, as a menu beside the page title. */
export function RuntimeFilter({
  runtime,
  onRuntime,
}: {
  runtime: RuntimeKind | null;
  onRuntime: (runtime: RuntimeKind | null) => void;
}): ReactElement {
  return (
    <Combobox
      value={runtime ?? ALL_RUNTIMES}
      options={RUNTIME_OPTIONS}
      searchable={false}
      className="min-w-48"
      onValueChange={(value) =>
        onRuntime(USAGE_RUNTIMES.find((candidate) => candidate === value) ?? null)
      }
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Runtime"
          className="-ml-2 gap-1.5 px-2 text-base font-semibold"
        >
          {runtime ? (
            <AgentRuntimeIcon runtimeKind={runtime} className="size-4" />
          ) : (
            <Layers className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
          {runtime ? USAGE_RUNTIME_LABELS[runtime] : "All runtimes"}
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </Button>
      }
    />
  );
}

export function RangeTabs({
  rangeKind,
  onRangeKind,
}: {
  rangeKind: RangeKind;
  onRangeKind: (kind: RangeKind) => void;
}): ReactElement {
  return (
    <ToggleTabs
      aria-label="Date range"
      value={rangeKind}
      onValueChange={onRangeKind}
      // A narrow page gives the five ranges a full-width row of equal cells.
      className="grid w-full grid-cols-[repeat(4,minmax(2.5rem,1fr))_auto] gap-0.5 @lg:inline-flex @lg:w-fit @lg:gap-0"
    >
      {RANGE_OPTIONS.map((option) => (
        <ToggleTabsItem
          key={option.kind}
          value={option.kind}
          aria-label={option.label}
          className={option.kind === "custom" ? "px-3" : "px-1 @lg:px-3"}
        >
          <span className="@lg:hidden" aria-hidden="true">
            {option.short}
          </span>
          <span className="hidden @lg:inline" aria-hidden="true">
            {option.label}
          </span>
        </ToggleTabsItem>
      ))}
    </ToggleTabs>
  );
}

/** The dates of a custom range. It checks them before it applies them. */
export function CustomRangeForm({
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

export function MetricTabs({
  metric,
  onMetric,
}: {
  metric: UsageMetric;
  onMetric: (metric: UsageMetric) => void;
}): ReactElement {
  return (
    <ToggleTabs aria-label="Metric" value={metric} onValueChange={onMetric}>
      <ToggleTabsItem value="tokens">{METRIC_TEXT.tokens.label}</ToggleTabsItem>
      <ToggleTabsItem value="cost">{METRIC_TEXT.cost.label}</ToggleTabsItem>
    </ToggleTabs>
  );
}

/** Reads the report again. Its tooltip gives the time of the shown result. */
export function RefreshButton({
  fetching,
  disabled,
  updatedText,
  onRefresh,
}: {
  fetching: boolean;
  disabled: boolean;
  updatedText: string | null;
  onRefresh: () => void;
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 rounded-lg bg-muted text-muted-foreground hover:text-foreground"
          aria-label={fetching ? "Refreshing" : "Refresh"}
          onClick={onRefresh}
          disabled={disabled}
        >
          <RefreshCw className={cn("size-4", fetching && "animate-spin")} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {fetching ? "Refreshing…" : (updatedText ?? "Refresh")}
      </TooltipContent>
    </Tooltip>
  );
}
