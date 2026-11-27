// The Usage page of usage-page.tsx and usage-layout.tsx: the header, then the skeleton of the
// first read or the report, with the overview and the Highlights. The markup shows the report and
// the texts of `metric`. A scene shows the skeleton with `hidden`, and changes `data-metric`, as
// the app renders the page again at once. The sections after Highlights are out of the frame.
import type { ReactElement } from "react";
import type { UsageMetric } from "./format";
import type { UsageReport } from "./model";
import { UsageHeader } from "./UsageHeader";
import { UsageHighlights } from "./UsageHighlights";
import { type ChartWidths, UsageOverview } from "./UsageOverview";
import { UsagePageSkeleton } from "./UsagePageSkeleton";
import "./UsagePage.css";

export function UsagePage({
  report,
  metric,
  charts,
}: {
  report: UsageReport;
  metric: UsageMetric;
  charts: ChartWidths;
}): ReactElement {
  return (
    <div className="usage-page" data-usage-page="" data-metric={metric}>
      <UsageHeader report={report} metric={metric} />
      <UsagePageSkeleton hidden data-skeleton="" />
      <div className="usage-result" data-report="">
        <UsageOverview report={report} charts={charts} />
        <UsageHighlights report={report} />
      </div>
    </div>
  );
}
