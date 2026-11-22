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
  missingReason,
  PERIOD_NOUNS,
  periodName,
  shownValue,
  USAGE_RUNTIME_COLORS,
  USAGE_RUNTIME_LABELS,
  type UsageMetric,
} from "./usage-format";
import { RuntimeDot } from "./usage-parts";

const CHART_HEIGHT = 260;
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

/** One point of one runtime. A null value is a gap: the period has no value to draw. */
type TrendRow = { index: number; date: Date; value: number | null; partial: boolean };

const rowsOf = (
  periods: readonly UsagePeriod[],
  runtime: RuntimeKind,
  metric: UsageMetric,
): TrendRow[] =>
  periods.map((period, index) => {
    const figure = period.runtimes.find((entry) => entry.runtime === runtime)?.figure;
    if (!figure) return { index, date: dateOf(period.start), value: 0, partial: false };
    return {
      index,
      date: dateOf(period.start),
      value: shownValue(figure, metric),
      // Unread history can make the value too low. The tooltip names other gaps.
      partial: !figure.complete,
    };
  });

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
      {rows.map(({ runtime, value }) => (
        <div key={runtime} className="flex items-center gap-2">
          <RuntimeDot runtime={runtime} />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {USAGE_RUNTIME_LABELS[runtime]}
          </span>
          <span className="font-medium tabular-nums">
            {value === null ? "—" : formatMetric(value, metric)}
          </span>
        </div>
      ))}
      {runtimes.length > 1 ? (
        <div className="mt-0.5 flex items-center justify-between gap-2 border-t border-border pt-1.5">
          <span className="text-muted-foreground">Total</span>
          <span className="font-medium tabular-nums">{formatMetric(total, metric)}</span>
        </div>
      ) : null}
      {notes.map((note) => (
        <span key={note} className="text-[11px] text-muted-foreground">
          {note}
        </span>
      ))}
    </div>
  );
}

/**
 * Usage over time: one smooth line per runtime on one shared zero-based axis. A period that is
 * still in progress, such as today, ends the line with a dashed segment.
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
    // A runtime that stays near zero in the view keeps its tooltip row and runtime list
    // entry, but draws no line along the baseline.
    const peakOf = (runtime: RuntimeKind) =>
      Math.max(0, ...rowsOf(periods, runtime, metric).map((row) => row.value ?? 0));
    const top = Math.max(0, ...runtimes.map(peakOf));
    const drawn = runtimes.filter((runtime) => top > 0 && peakOf(runtime) >= top * 0.005);
    const series = drawn.map((runtime) => {
      const rows = rowsOf(periods, runtime, metric);
      return {
        runtime,
        rows,
        // The solid line stops before a period in progress; a dashed segment reaches it.
        settled: inProgress
          ? rows.map((row) => (row.index === last ? { ...row, value: null } : row))
          : rows,
        current: inProgress ? rows.slice(-2) : [],
        today: inProgress ? rows.slice(-1).filter((row) => (row.value ?? 0) > 0) : [],
      };
    });
    const line = (runtime: RuntimeKind) => ({
      x: "date" as const,
      y: "value" as const,
      stroke: USAGE_RUNTIME_COLORS[runtime],
      strokeWidth: 2,
      // A lone value between gaps draws nothing, not a stray dot; the tooltip still shows it.
      lineCap: "butt" as const,
      curve,
    });
    return defineChart({
      margin: narrow ? NARROW_MARGIN : MARGIN,
      gradients: drawn.map((runtime) => ({
        id: `usage-area-${runtime}`,
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 1,
        stops: [
          { offset: 0, color: USAGE_RUNTIME_COLORS[runtime], opacity: 0.28 },
          { offset: 1, color: USAGE_RUNTIME_COLORS[runtime], opacity: 0 },
        ],
      })),
      marks: [
        ...series.map(({ runtime, rows }) =>
          decorative(
            areaY(rows, { x: "date", y: "value", fill: `url(#usage-area-${runtime})`, curve }),
          ),
        ),
        // A day without a value, such as usage without a published rate, is a gap. A faint
        // dotted bridge keeps the gap from reading as a drawing fault; the tooltip names it.
        ...series.map(({ runtime, settled }) =>
          decorative(
            lineY(
              settled.filter((row) => row.value !== null),
              { ...line(runtime), strokeDasharray: "2 4", strokeOpacity: 0.4, strokeWidth: 1.5 },
            ),
          ),
        ),
        ...series.map(({ runtime, settled }) =>
          lineY(settled, { id: `usage-line-${runtime}`, ...line(runtime) }),
        ),
        // The period in progress is still growing: a faint dashed segment to an open point.
        ...series.map(({ runtime, current }) =>
          decorative(
            lineY(current, { ...line(runtime), strokeDasharray: "4 4", strokeOpacity: 0.55 }),
          ),
        ),
        ...series.map(({ runtime, today }) =>
          decorative(
            dot(today, {
              x: "date",
              y: "value",
              r: 3,
              fill: "var(--background)",
              stroke: USAGE_RUNTIME_COLORS[runtime],
              strokeWidth: 1.5,
            }),
          ),
        ),
        // A value with unread history shows an open point: it can be higher.
        ...series.map(({ runtime, rows }) =>
          decorative(
            dot(
              rows.filter((row) => row.partial && row.value !== null),
              {
                x: "date",
                y: "value",
                r: 3,
                fill: "var(--background)",
                stroke: USAGE_RUNTIME_COLORS[runtime],
                strokeWidth: 1.5,
              },
            ),
          ),
        ),
        // The inspected period shows a point on every line.
        ...series.map(({ runtime, rows }) =>
          whenFocused(
            dot(
              rows.filter((row) => row.value !== null),
              {
                x: "date",
                y: "value",
                r: 4,
                fill: USAGE_RUNTIME_COLORS[runtime],
                stroke: "var(--background)",
                strokeWidth: 2,
              },
            ),
            { match: "x" },
          ),
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
        // The dots on every line show the inspected period; a ring would mark one of them.
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

  const renderTooltipBody = ({ points }: ChartTooltipBodyRenderContext<TrendRow>) => {
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
        ariaLabel={`${metric === "tokens" ? "Tokens" : "Estimated cost"} per ${PERIOD_NOUNS[granularity]} and runtime`}
        renderTooltipBody={renderTooltipBody}
      />
    </div>
  );
}
