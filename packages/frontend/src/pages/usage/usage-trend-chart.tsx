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
  formatAxisDate,
  formatAxisMetric,
  formatMetric,
  formatShare,
  GAP_TEXT,
  labelDates,
  METRIC_TEXT,
  type PeriodPart,
  PERIOD_TEXT,
  periodName,
  periodTotal,
  shareOf,
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

/** The total of one period. `partial` marks a total that can be higher: see `periodTotal`. */
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
    const total = periodTotal(period, runtimes, metric);
    let low = 0;
    for (const part of total.parts) {
      const high = low + (part.value ?? 0);
      bands.get(part.runtime)?.push({ index, date, low, high });
      low = high;
    }
    return { index, date, value: total.value, partial: total.partial };
  });
  return { bands, totals };
};

/** The share of a runtime in the total of its period. A runtime without usage has a zero share. */
const partShare = (part: PeriodPart, total: number, metric: UsageMetric): number | null => {
  if (part.figure) return shareOf(part.figure, total, metric);
  return total > 0 ? 0 : null;
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
  const total = periodTotal(period, runtimes, metric);
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
          <span className="text-sm font-semibold tabular-nums">
            {formatMetric(total.value, metric)}
          </span>
        </div>
      ) : null}
      {total.parts.map((part) => {
        const { runtime, value } = part;
        const share = runtimes.length > 1 ? partShare(part, total.value, metric) : null;
        return (
          <div key={runtime} className="flex items-center gap-2">
            <RuntimeDot runtime={runtime} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {USAGE_RUNTIME_LABELS[runtime]}
            </span>
            {share === null ? null : (
              <span className="text-muted-foreground tabular-nums">{formatShare(share)}</span>
            )}
            {/* The tooltip follows the pointer, so a dash cannot explain itself on hover. The
                notes below give its reason. */}
            <span className="min-w-14 text-right font-medium tabular-nums">
              {value === null ? "—" : formatMetric(value, metric)}
            </span>
          </div>
        );
      })}
      {total.gaps.map((gap) => (
        <span key={gap} className="text-[11px] text-muted-foreground">
          {GAP_TEXT[gap].short}
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
        decorative(lineY(settled, { ...totalLine, strokeWidth: single ? 2 : 1.75 })),
        // Pointer and keyboard focus take every period, also the one in progress, which the
        // solid line stops before. This line only carries the focus; the marks above draw.
        lineY(totals, { id: "usage-total", ...totalLine, strokeOpacity: 0 }),
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
        // A partial total shows an open point: it can be higher. The point of the period in
        // progress already marks the last period.
        decorative(
          dot(
            totals.filter((row) => row.partial && !(row.index === last && today.length > 0)),
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
        ariaLabel={`${PERIOD_TEXT[granularity].adjective} ${METRIC_TEXT[metric].trend}: total and runtimes`}
        renderTooltipBody={renderTooltipBody}
      />
    </div>
  );
}
