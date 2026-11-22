import type { RuntimeKind, UsageGranularity, UsagePeriod } from "@openducktor/contracts";
import { areaY, defineChart, dot, lineY } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { whenFocused } from "@tanstack/charts/focus/mark";
import { decorative } from "@tanstack/charts/mark/decorative";
import { Chart, type ChartTooltipBodyRenderContext } from "@tanstack/charts/react/tooltip";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleUtc } from "@tanstack/charts/scales/time";
import { tooltip } from "@tanstack/charts/tooltip";
import { curveMonotoneX } from "d3-shape";
import { type ReactElement, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  dateOf,
  formatCountOf,
  formatAxisDate,
  formatAxisMetric,
  formatMetric,
  formatShare,
  missingReason,
  PERIOD_NOUNS,
  periodName,
  shownValue,
  USAGE_RUNTIME_COLORS,
  USAGE_RUNTIME_LABELS,
  type UsageMetric,
} from "./usage-format";
import { RuntimeDot } from "./usage-parts";

const CHART_HEIGHT = 280;
const curve = d3Curve(curveMonotoneX);
/** A fixed axis gutter, so the plot keeps its place when the metric changes. */
const MARGIN = { top: 12, right: 8, bottom: 28, left: 56 };
const NARROW_MARGIN = { ...MARGIN, left: 44 };

/** The number of date labels that fit a plot of a width. */
const labelCountFor = (width: number): number =>
  width < 360 ? 3 : width < 560 ? 4 : width < 800 ? 5 : 7;

/**
 * Label dates in equal steps back from the last period, plus the first period. The first period
 * takes the place of a label closer than half a step, so no two labels crowd.
 */
export const labelDates = (
  periods: readonly UsagePeriod[],
  count: number,
  granularity: UsageGranularity,
): Date[] => {
  const last = periods.length - 1;
  if (last < 0) return [];
  const even = Math.max(1, Math.ceil(last / Math.max(1, count - 1)));
  // Days step in whole weeks once a step passes a few days, so labels fall on one weekday.
  const step = granularity === "day" && even > 3 ? 7 * Math.max(1, Math.round(even / 7)) : even;
  const indexes: number[] = [];
  for (let index = last; index > 0; index -= step) indexes.unshift(index);
  if (indexes.length > 0 && (indexes[0] ?? 0) < step / 2) indexes.shift();
  indexes.unshift(0);
  return indexes.flatMap((index) => {
    const period = periods[index];
    return period ? [dateOf(period.start)] : [];
  });
};

/** The width of an element, measured before the first paint and on each resize. */
const useWidth = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(Math.round(element.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
};

/**
 * One point of one runtime in the stack: its band from `low` to `high`. A runtime without a value
 * in a period, such as usage without a rate, adds nothing there; the tooltip names the gap.
 */
type StackRow = { index: number; date: Date; low: number; high: number };

/** The total of one period. `partial` marks a total that unread history can make too low. */
type TotalRow = { index: number; date: Date; value: number; partial: boolean };

/** The bands of the runtimes, stacked in runtime order, and the total of each period. */
const stackOf = (
  periods: readonly UsagePeriod[],
  runtimes: readonly RuntimeKind[],
  metric: UsageMetric,
) => {
  const bands = new Map<RuntimeKind, StackRow[]>(runtimes.map((runtime) => [runtime, []]));
  const totals: TotalRow[] = periods.map((period, index) => {
    const date = dateOf(period.start);
    let value = 0;
    let partial = false;
    const figures = new Map(period.runtimes.map((entry) => [entry.runtime, entry.figure]));
    for (const runtime of runtimes) {
      const figure = figures.get(runtime);
      const shown = figure ? (shownValue(figure, metric) ?? 0) : 0;
      if (figure && !figure.complete) partial = true;
      bands.get(runtime)?.push({ index, date, low: value, high: value + shown });
      value += shown;
    }
    return { index, date, value, partial };
  });
  return { bands, totals };
};

/** The values of one period for the tooltip, with their total and what they leave out. */
function TrendTooltip({
  period,
  runtimes,
  granularity,
  metric,
  inProgress,
}: {
  period: UsagePeriod;
  runtimes: readonly RuntimeKind[];
  granularity: UsageGranularity;
  metric: UsageMetric;
  inProgress: boolean;
}): ReactElement {
  let total = 0;
  let unmeasured = 0;
  let unpriced = false;
  let unread = false;
  const reasons = new Set<string>();
  const rows = runtimes.map((runtime) => {
    const figure = period.runtimes.find((entry) => entry.runtime === runtime)?.figure;
    const value = figure ? shownValue(figure, metric) : 0;
    if (value !== null) total += value;
    if (figure) {
      const reason = value === null ? missingReason(figure, metric) : null;
      if (reason) reasons.add(reason);
      else if (metric === "tokens")
        unmeasured += figure.tokens.processed > 0 ? figure.unmeasured : 0;
      else if (figure.cost.state === "partial") unpriced = true;
      if (!figure.complete) unread = true;
    }
    return { runtime, value };
  });
  const notes = [
    ...reasons,
    unmeasured > 0 ? `${formatCountOf(unmeasured, "request")} without token counts` : null,
    unpriced ? "Some usage has no rate" : null,
    unread ? "Some history could not be read" : null,
  ].filter((note): note is string => note !== null);
  return (
    // A custom tooltip body owns its surface.
    <div className="flex min-w-48 flex-col gap-1.5 rounded-lg border border-border bg-popover/95 px-3 py-2.5 backdrop-blur-sm text-xs text-popover-foreground shadow-lg">
      <div className="font-medium">
        {periodName(period, granularity)}
        {inProgress ? <span className="font-normal text-muted-foreground"> · so far</span> : null}
      </div>
      {runtimes.length > 1 ? (
        <div className="flex items-center justify-between gap-2 border-b border-border pb-1.5">
          <span className="flex items-center gap-2 font-medium">
            <span className="h-0.5 w-2.5 rounded-full bg-foreground" aria-hidden="true" />
            Total
          </span>
          <span className="text-sm font-semibold tabular-nums">{formatMetric(total, metric)}</span>
        </div>
      ) : null}
      {rows.map(({ runtime, value }) => (
        <div key={runtime} className="flex items-center gap-2">
          <RuntimeDot runtime={runtime} />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {USAGE_RUNTIME_LABELS[runtime]}
          </span>
          {runtimes.length > 1 && value !== null && total > 0 ? (
            <span className="text-muted-foreground tabular-nums">{formatShare(value / total)}</span>
          ) : null}
          <span className="min-w-14 text-right font-medium tabular-nums">
            {value === null ? "—" : formatMetric(value, metric)}
          </span>
        </div>
      ))}
      {notes.map((note) => (
        <span key={note} className="text-[11px] text-muted-foreground">
          {note}
        </span>
      ))}
    </div>
  );
}

/**
 * Usage over time: the runtimes as stacked bands on one zero-based axis, and the total of all of
 * them as a line on top. A period that is still in progress, such as today, ends the total with a
 * dashed segment and an open point.
 */
export function UsageTrendChart({
  periods,
  granularity,
  runtimes,
  metric,
  inProgress,
}: {
  periods: readonly UsagePeriod[];
  granularity: UsageGranularity;
  runtimes: readonly RuntimeKind[];
  metric: UsageMetric;
  inProgress: boolean;
}): ReactElement {
  const { ref, width } = useWidth();
  const narrow = width > 0 && width < 480;
  const labelCount = labelCountFor(width);
  const definition = useMemo(() => {
    const last = periods.length - 1;
    const ticks = labelDates(periods, labelCount, granularity);
    const firstTick = ticks[0]?.getTime();
    const lastTick = ticks.at(-1)?.getTime();
    const { bands, totals } = stackOf(periods, runtimes, metric);
    const single = runtimes.length === 1 ? runtimes[0] : undefined;
    // With one runtime, its band is the total: the line takes its color.
    const totalColor = single ? USAGE_RUNTIME_COLORS[single] : "var(--foreground)";
    const settled = inProgress ? totals.slice(0, -1) : totals;
    const current = inProgress ? totals.slice(-2) : [];
    const today = inProgress ? totals.slice(-1).filter((row) => row.value > 0) : [];
    const totalLine = { x: "date" as const, y: "value" as const, stroke: totalColor, curve };
    return defineChart({
      margin: narrow ? NARROW_MARGIN : MARGIN,
      marks: [
        ...runtimes.map((runtime) =>
          decorative(
            areaY(bands.get(runtime) ?? [], {
              x: "date",
              y1: "low",
              y2: "high",
              fill: USAGE_RUNTIME_COLORS[runtime],
              fillOpacity: single ? 0.16 : 0.26,
              curve,
            }),
          ),
        ),
        // The top of each band, so neighbors stay apart where their colors meet.
        ...(single
          ? []
          : runtimes.map((runtime) =>
              decorative(
                lineY(bands.get(runtime) ?? [], {
                  x: "date",
                  y: "high",
                  stroke: USAGE_RUNTIME_COLORS[runtime],
                  strokeWidth: 1.5,
                  curve,
                }),
              ),
            )),
        lineY(settled, { id: "usage-total", ...totalLine, strokeWidth: single ? 2 : 1.75 }),
        // The period in progress is still growing: a faint dashed segment to an open point.
        decorative(
          lineY(current, {
            ...totalLine,
            strokeWidth: 2,
            strokeDasharray: "4 4",
            strokeOpacity: 0.6,
          }),
        ),
        decorative(
          dot(today, {
            x: "date",
            y: "value",
            r: 3.5,
            fill: "var(--background)",
            stroke: totalColor,
            strokeWidth: 1.75,
          }),
        ),
        // A total with unread history shows an open point: it can be higher.
        decorative(
          dot(
            totals.filter((row) => row.partial && row.index !== last),
            {
              x: "date",
              y: "value",
              r: 3,
              fill: "var(--background)",
              stroke: totalColor,
              strokeWidth: 1.5,
            },
          ),
        ),
        // The inspected period shows a point on the total.
        whenFocused(
          dot(totals, {
            x: "date",
            y: "value",
            r: 4.5,
            fill: totalColor,
            stroke: "var(--background)",
            strokeWidth: 2,
          }),
          { match: "x" },
        ),
        crosshair({ x: true, y: false }),
      ],
      scales: {
        x: {
          scale: scaleUtc,
          axis: {
            line: false,
            // The first and the last date of the range always show, inside the plot.
            tickLabels: {
              fontSize: 11,
              anchor: ({ value }) =>
                value.getTime() === firstTick
                  ? "start"
                  : value.getTime() === lastTick
                    ? "end"
                    : "middle",
            },
            ticks: {
              values: ticks,
              size: 0,
              padding: 10,
              format: (value: Date) => formatAxisDate(value, granularity),
            },
          },
        },
        y: {
          scale: scaleLinear,
          nice: true,
          // A visible but quiet line at each value label, in both themes.
          grid: { stroke: "var(--muted-foreground)", strokeOpacity: 0.22, strokeWidth: 1 },
          axis: {
            line: false,
            tickLabels: { fontSize: 11 },
            ticks: {
              count: 4,
              size: 0,
              padding: 10,
              format: (value: number) => formatAxisMetric(value, metric),
            },
          },
        },
      },
      theme: {
        foreground: "var(--muted-foreground)",
        muted: "var(--muted-foreground)",
        // The point on the total shows the inspected period; a ring would add a second mark.
        focusRing: false,
      },
      focus: "group-x",
      maxFocusDistance: Number.POSITIVE_INFINITY,
      tooltip: {
        use: tooltip,
        // The tooltip sits at the top of the plot, so it never covers the lines it describes.
        anchor: { x: "value", y: "plot-top" },
        placement: ["right", "left"],
        offset: 16,
      },
    });
  }, [periods, runtimes, metric, granularity, inProgress, narrow, labelCount]);

  const renderTooltipBody = ({ points }: ChartTooltipBodyRenderContext<TotalRow>) => {
    const index = points[0]?.datum.index;
    const period = index === undefined ? undefined : periods[index];
    if (!period || index === undefined) return null;
    return (
      <TrendTooltip
        period={period}
        runtimes={runtimes}
        granularity={granularity}
        metric={metric}
        inProgress={inProgress && index === periods.length - 1}
      />
    );
  };

  return (
    <div ref={ref} className="min-w-0">
      <Chart
        definition={definition}
        height={CHART_HEIGHT}
        ariaLabel={`${metric === "tokens" ? "Tokens" : "Estimated cost"} per ${PERIOD_NOUNS[granularity]}: total and runtimes`}
        renderTooltipBody={renderTooltipBody}
      />
    </div>
  );
}
