// The CI Checks tab of task-execution-ci-checks-content.tsx for the linked pull request.
// `state` sets the aggregate status; the scene flips `data-checks` when the checks finish.
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import type { ReactElement } from "react";
import "./ChecksPanel.css";

type ChecksPanelProps = {
  title: string;
  updated: string;
  checks: readonly string[];
  state: "passing" | "pending";
};

export function ChecksPanel({ title, updated, checks, state }: ChecksPanelProps): ReactElement {
  return (
    <div className="st-checks" data-panel="ci_checks" data-checks={state}>
      <div className="st-checks-head">
        <b>{title}</b>
        <small>
          Updated <span data-checks-updated="">{updated}</span>
          <RefreshCw className="i14" />
        </small>
      </div>
      <div className="st-checks-list">
        <div className="st-checks-sum">
          <ChevronDown />
          <CircleCheck className="tone" />
          <b>Checks</b>
          <span className="tone">
            <span className="when-done">{checks.length} passing</span>
            <span className="when-pending">{checks.length} pending</span>
          </span>
          <span className="st-checks-badge" data-checks-badge="">
            <span className="when-done">Passing</span>
            <span className="when-pending">Pending</span>
          </span>
        </div>
        {checks.map((name) => (
          <div className="st-check" key={name}>
            <ChevronRight className="i14" />
            <CircleCheck className="when-done tone" />
            <Clock className="when-pending tone" />
            <b>{name}</b>
            <small className="tone">
              <span className="when-done">success</span>
              <span className="when-pending">in progress</span>
            </small>
            <span>
              <ExternalLink className="i14" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
