// The trend chart of usage-trend-chart.tsx at one width: the runtimes as stacked bands on one
// zero-based axis, and their total as a line on top. The last day is still in progress, so the
// total ends with a dashed segment and an open point. The chart holds the marks and the axis of
// each metric, and the metric of the page shows one set, as the app redraws the chart at once.
// chart.ts moves the crosshair and the tooltip.
import type { ReactElement } from "react";
import type { UsageMetric } from "./format";
import type { UsageReport } from "./model";
import { type ChartBox, chartBox, marksOf, xAxis, yAxis } from "./trend";
import { TrendTooltip } from "./TrendTooltip";
import "./TrendChart.css";

const METRICS = ["tokens", "cost"] as const satisfies readonly UsageMetric[];

type ChartPart = { box: ChartBox; report: UsageReport; metric: UsageMetric };

/** The grid lines of a metric, under the marks. */
function Grid({ box, report, metric }: ChartPart): ReactElement {
  return (
    <g className="usage-grid" data-axis={metric}>
      {yAxis(box, report, metric).map((tick) => (
        <line key={tick.text} x1={box.left} x2={box.right} y1={tick.at} y2={tick.at} />
      ))}
    </g>
  );
}

/** The bands and the total of a metric. */
function Marks({ box, report, metric }: ChartPart): ReactElement {
  const marks = marksOf(box, report, metric);
  return (
    <g data-axis={metric}>
      {marks.bands.map((band) => (
        <path
          key={band.runtime}
          className="usage-band-area"
          data-series={band.runtime}
          d={band.area}
        />
      ))}
      {marks.bands.map((band) => (
        <path
          key={band.runtime}
          className="usage-band-line"
          data-series={band.runtime}
          d={band.line}
        />
      ))}
      <path className="usage-total-line" d={marks.total} />
      <path className="usage-current-line" d={marks.current} />
      {marks.today && (
        <circle className="usage-today-dot" cx={marks.today[0]} cy={marks.today[1]} r={3.5} />
      )}
    </g>
  );
}

/** The value labels of a metric, left of the plot. */
function ValueLabels({ box, report, metric }: ChartPart): ReactElement {
  return (
    <g className="usage-axis" data-axis={metric}>
      {yAxis(box, report, metric).map((tick) => (
        <text
          key={tick.text}
          x={box.left - 10}
          y={tick.at}
          textAnchor="end"
          dominantBaseline="middle"
        >
          {tick.text}
        </text>
      ))}
    </g>
  );
}

/** The chart for a column of `width` design pixels. */
export function TrendChart({
  report,
  width,
}: {
  report: UsageReport;
  width: number;
}): ReactElement {
  const box = chartBox(width);
  return (
    <div className="usage-chart" data-chart={width}>
      <svg className="usage-chart-svg" viewBox={`0 0 ${box.width} ${box.height}`}>
        {METRICS.map((metric) => (
          <Grid key={metric} box={box} report={report} metric={metric} />
        ))}
        {METRICS.map((metric) => (
          <Marks key={metric} box={box} report={report} metric={metric} />
        ))}
        {/* The point of the inspected day sits over the marks and under the labels and the
            crosshair, as the focus layer of the chart draws it. */}
        <circle className="usage-focus-dot" data-focus-dot="" r={4.5} visibility="hidden" />
        <g className="usage-axis">
          {xAxis(box, report).map((label) => (
            <text key={label.text} x={label.at} y={270.8} textAnchor={label.anchor}>
              {label.text}
            </text>
          ))}
        </g>
        {METRICS.map((metric) => (
          <ValueLabels key={metric} box={box} report={report} metric={metric} />
        ))}
        <line
          className="usage-crosshair"
          data-crosshair=""
          x1={0}
          x2={0}
          y1={box.top}
          y2={box.bottom}
          visibility="hidden"
        />
      </svg>
      <TrendTooltip report={report} />
    </div>
  );
}
