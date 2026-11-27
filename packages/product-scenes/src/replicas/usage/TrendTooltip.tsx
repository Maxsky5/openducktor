// TrendTooltip of usage-trend-chart.tsx: the values of one day, with their total. The chart shows
// it at the top of the plot, beside the inspected day. chart.ts fills it with the inspected day.
import type { ReactElement } from "react";
import { USAGE_RUNTIME_LABELS } from "./format";
import type { UsageReport } from "./model";
import { RuntimeDot } from "./UsageParts";
import "./TrendTooltip.css";

export function TrendTooltip({ report }: { report: UsageReport }): ReactElement {
  return (
    <div className="usage-tip" data-chart-tip="" hidden>
      <div className="usage-tip-day">
        <span data-tip-day="" />
        <span className="usage-tip-so-far" data-tip-so-far="" hidden>
          {" "}
          · so far
        </span>
      </div>
      <div className="usage-tip-total">
        <span className="usage-tip-total-label">
          <span className="usage-total-swatch" />
          Total
        </span>
        <span className="usage-tip-total-value" data-tip-total="" />
      </div>
      {report.runtimes.map((usage) => (
        <div key={usage.runtime} className="usage-tip-row" data-tip-row={usage.runtime}>
          <RuntimeDot runtime={usage.runtime} />
          <span className="usage-tip-name">{USAGE_RUNTIME_LABELS[usage.runtime]}</span>
          <span className="usage-tip-share" data-tip-share="" />
          <span className="usage-tip-value" data-tip-value="" />
        </div>
      ))}
    </div>
  );
}
