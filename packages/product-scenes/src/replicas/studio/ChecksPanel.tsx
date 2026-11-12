// The CI Checks tab of task-execution-ci-checks-content.tsx for the linked pull request: the title
// of the pull request with its refresh time, the check rows of task-execution-ci-checks-list.tsx,
// and the comments of task-execution-ci-comments-list.tsx. Each row has its own state, and the
// panel shows the status of all rows. A scene changes `data-state` of a row, `data-checks` of the
// panel, and the summary text. A row with `data-open` shows the rows of
// task-execution-ci-check-card.tsx. The checks and the comments scroll under the head, and a
// closed Checks section shows only its summary. Without comments, the tab shows the empty state.
import {
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  ExternalLink,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { flag } from "../flag";
import { type CheckInfo, checksStatus, checksSummary, type CiCheck } from "./model";
import "./ChecksPanel.css";

type ChecksPanelProps = {
  title: string;
  updated: string;
  checks: readonly CiCheck[];
  /** The name of the check that shows its rows. */
  open?: string;
  /** The Checks section is closed and shows only its summary. */
  checksClosed?: boolean;
  /** The comments section, such as CommentsList. */
  comments?: ReactNode;
};

/** The words of the product: the status badges, the check states, and the empty comments. */
export const CHECKS_TEXT = {
  passing: "Passing",
  failing: "Failing",
  pending: "Pending",
  success: "Success",
  failure: "Failure",
  inProgress: "in progress",
  noComments: "No comments reported.",
} as const;

function CheckRows({ info }: { info: CheckInfo }): ReactElement {
  return (
    <dl className="st-check-info" data-check-info="">
      <dt>Workflow</dt>
      <dd>{info.workflow}</dd>
      <dt>Details</dt>
      <dd>{info.details}</dd>
      <dt>Started</dt>
      <dd>{info.started}</dd>
      <dt>Completed</dt>
      <dd>{info.completed}</dd>
    </dl>
  );
}

function CheckItem({ check, open }: { check: CiCheck; open: boolean }): ReactElement {
  return (
    <div
      className="st-check-item"
      data-check={check.name}
      data-state={check.state}
      data-open={flag(open)}
    >
      <div className="st-check" data-check-row="">
        <ChevronRight className="i14 st-check-chevron" />
        <CircleCheck className="when-success tone" />
        <CircleX className="when-failure tone" />
        <Clock className="when-pending tone" />
        <b>{check.name}</b>
        <small className="tone">
          <span className="when-success">{CHECKS_TEXT.success}</span>
          <span className="when-failure">{CHECKS_TEXT.failure}</span>
          <span className="when-pending">{CHECKS_TEXT.inProgress}</span>
        </small>
        <span>
          <ExternalLink className="i14" />
        </span>
      </div>
      {check.info && <CheckRows info={check.info} />}
    </div>
  );
}

function NoComments(): ReactElement {
  return (
    <>
      <div className="st-checks-sum st-comments">
        <ChevronRight className="st-checks-chevron" />
        <MessageSquare className="st-comments-icon" />
        <b>Comments</b>
        <span className="st-comments-count">0</span>
      </div>
      <p className="st-comments-empty">{CHECKS_TEXT.noComments}</p>
    </>
  );
}

export function ChecksPanel({
  title,
  updated,
  checks,
  open,
  checksClosed = false,
  comments,
}: ChecksPanelProps): ReactElement {
  const states = checks.map((check) => check.state);
  return (
    <div className="st-checks" data-panel="ci_checks" data-checks={checksStatus(states)}>
      <div className="st-checks-head">
        <b>{title}</b>
        <small>
          Updated <span data-checks-updated="">{updated}</span>
          <span className="st-checks-refresh" data-checks-refresh="">
            <RefreshCw className="i14" />
          </span>
        </small>
      </div>
      <div className="st-checks-body" data-checks-body="">
        <div className="st-checks-list" data-closed={flag(checksClosed)}>
          <div className="st-checks-sum">
            <ChevronRight className="st-checks-chevron" />
            <CircleCheck className="tone" />
            <b>Checks</b>
            <span className="tone" data-checks-summary="">
              {checksSummary(states)}
            </span>
            <span className="st-checks-badge" data-checks-badge="">
              <span className="when-passing">{CHECKS_TEXT.passing}</span>
              <span className="when-failing">{CHECKS_TEXT.failing}</span>
              <span className="when-pending">{CHECKS_TEXT.pending}</span>
            </span>
          </div>
          <div className="st-checks-rows">
            {checks.map((check) => (
              <CheckItem check={check} open={check.name === open} key={check.name} />
            ))}
          </div>
        </div>
        {comments ?? <NoComments />}
      </div>
    </div>
  );
}
