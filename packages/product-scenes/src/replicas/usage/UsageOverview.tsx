// UsageOverview of usage-overview.tsx: the total of the range, the part of each runtime, and the
// trend chart. Each text that changes with the metric holds its words for both metrics in
// MetricText, and the metric of the page shows one of them. The overview holds the chart of the
// wide layout and of the narrow layout of a phone stage, at the widths of their columns.
import type { ReactElement } from "react";
import { RuntimeIcon } from "../ui/RuntimeIcon";
import { formatMetric, METRIC_TEXT, USAGE_RUNTIME_LABELS } from "./format";
import {
  chartTitle,
  reportTotal,
  type RuntimeUsage,
  runtimeLine,
  summaryText,
  type UsageReport,
} from "./model";
import { MetricText } from "./MetricText";
import { TrendChart } from "./TrendChart";
import { RuntimeDot } from "./UsageParts";
import "./UsageOverview.css";

/** The width of the chart column in the wide layout and in the narrow layout. */
export type ChartWidths = { wide: number; narrow: number };

function RuntimeRow({ report, usage }: { report: UsageReport; usage: RuntimeUsage }): ReactElement {
  const tokens = runtimeLine(report, usage, "tokens");
  const cost = runtimeLine(report, usage, "cost");
  return (
    <li className="usage-runtime">
      <div className="usage-runtime-head">
        <RuntimeDot runtime={usage.runtime} />
        <RuntimeIcon kind={usage.runtime} />
        <span className="usage-runtime-name">{USAGE_RUNTIME_LABELS[usage.runtime]}</span>
        <span className="usage-runtime-value">
          <MetricText tokens={tokens.value} cost={cost.value} />
        </span>
      </div>
      {/* Each part keeps one line, and a separator ends the part before it. */}
      <span className="usage-runtime-line">
        <span>{tokens.sessions} ·</span>
        <span>
          <MetricText tokens={tokens.share} cost={cost.share} />
          <span className="usage-share-noun">
            <MetricText tokens={tokens.noun} cost={cost.noun} />
          </span>{" "}
          ·
        </span>
        <span>
          <MetricText tokens={tokens.other} cost={cost.other} />
        </span>
      </span>
    </li>
  );
}

export function UsageOverview({
  report,
  charts,
}: {
  report: UsageReport;
  charts: ChartWidths;
}): ReactElement {
  return (
    <div className="usage-overview">
      <div className="usage-overview-side">
        <div className="usage-total">
          <span className="usage-total-title">
            <MetricText tokens={METRIC_TEXT.tokens.headline} cost={METRIC_TEXT.cost.headline} />
          </span>
          <span className="usage-total-value">
            <MetricText
              tokens={formatMetric(reportTotal(report, "tokens"), "tokens")}
              cost={formatMetric(reportTotal(report, "cost"), "cost")}
            />
          </span>
          <span className="usage-total-summary">
            <MetricText tokens={summaryText(report, "tokens")} cost={summaryText(report, "cost")} />
          </span>
        </div>
        <ul className="usage-runtimes">
          {report.runtimes.map((usage) => (
            <RuntimeRow key={usage.runtime} report={report} usage={usage} />
          ))}
        </ul>
      </div>
      <div className="usage-trend">
        <div className="usage-trend-head">
          <p className="usage-trend-title">
            <MetricText tokens={chartTitle("tokens")} cost={chartTitle("cost")} />
          </p>
          <span className="usage-trend-legend">
            <span className="usage-legend-swatch" />
            Total
          </span>
        </div>
        <div className="usage-chart-wide" data-chart-layout="wide">
          <TrendChart report={report} width={charts.wide} />
        </div>
        <div className="usage-chart-narrow" data-chart-layout="narrow">
          <TrendChart report={report} width={charts.narrow} />
        </div>
      </div>
    </div>
  );
}
