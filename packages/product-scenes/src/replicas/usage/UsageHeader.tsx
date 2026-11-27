// The header of usage-page.tsx: the title with the runtime menu of usage-filters.tsx, the dates
// and time of the shown result, and the range tabs, the metric tabs, and the refresh button. While
// the first read of the page runs, the header has no result line, and the refresh button is
// disabled and spins: a scene sets `data-fetching` on the page.
import { ChevronDown, Layers, RefreshCw } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import { ToggleTabs, ToggleTabsItem } from "../ui/ToggleTabs";
import { formatRange, METRIC_TEXT, type UsageMetric } from "./format";
import type { UsageReport } from "./model";
import "./UsageHeader.css";

/** The range of the page when it opens: the first state of rangeKind in usage-page.tsx. */
const OPEN_RANGE = "last_30_days";

/** RANGE_OPTIONS of usage-filters.tsx: a narrow page shows the short labels. */
export const RANGE_TABS = [
  { kind: "last_7_days", label: "7 days", short: "7d" },
  { kind: "last_30_days", label: "30 days", short: "30d" },
  { kind: "last_90_days", label: "90 days", short: "90d" },
  { kind: "all_time", label: "All time", short: "All" },
  { kind: "custom", label: "Custom", short: "Custom" },
] as const;

export function UsageHeader({
  report,
  metric,
}: {
  report: UsageReport;
  metric: UsageMetric;
}): ReactElement {
  return (
    <div className="usage-header">
      <div className="usage-heading">
        <div className="usage-title-row">
          <p className="usage-title">Usage</p>
          <span className="usage-title-separator">/</span>
          <Button variant="ghost" size="sm" className="usage-runtime-filter">
            <Layers className="i16 usage-muted-icon" aria-hidden="true" />
            All runtimes
            <ChevronDown className="i16 usage-muted-icon" aria-hidden="true" />
          </Button>
        </div>
        <p className="usage-result-line">
          <span>{formatRange(report.start, report.end)}</span>
          <span> · Updated {report.updated}</span>
        </p>
      </div>
      <div className="usage-controls">
        <ToggleTabs className="usage-range-tabs">
          {RANGE_TABS.map((tab) => (
            <ToggleTabsItem key={tab.kind} checked={tab.kind === OPEN_RANGE} data-range={tab.kind}>
              <span className="usage-range-short">{tab.short}</span>
              <span className="usage-range-label">{tab.label}</span>
            </ToggleTabsItem>
          ))}
        </ToggleTabs>
        <ToggleTabs>
          {(["tokens", "cost"] as const).map((kind) => (
            <ToggleTabsItem key={kind} checked={kind === metric} data-metric-tab={kind}>
              {METRIC_TEXT[kind].label}
            </ToggleTabsItem>
          ))}
        </ToggleTabs>
        <Button variant="ghost" size="icon" className="usage-refresh">
          <RefreshCw className="i16" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
