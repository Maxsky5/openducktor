// An ODT tool card of agent-chat-workflow-tool-message.tsx: the icon, the title, the pull request
// of a completed odt_set_pull_request call, the status while the call runs, the timing, and the
// controls of a completed call. A saved artifact reads "Set Spec", "Reject QA", or
// "Set Artifact · <name>". A workflow event takes its event as the title, such as "Build
// Completed". A press on the card shows the call in the tool details, so the title has no chevron.
import {
  ExternalLink,
  File,
  FileText,
  GitPullRequest,
  type LucideIcon,
  ShieldX,
  Workflow,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { WorkflowIcon } from "./model";
import { RowTime } from "./RowTime";
import "../studio/PullRequestLink.css";
import "./WorkflowCard.css";

type WorkflowCardProps = {
  title: string;
  icon: WorkflowIcon;
  /**
   * The icon while the call runs, when it is not `icon`. An artifact call shows its free icon only
   * after the result names a free artifact.
   */
  runningIcon?: WorkflowIcon;
  /** The pull request that a completed odt_set_pull_request call saved. */
  pr?: number | undefined;
  /** The controls of a completed call, such as Open of a saved file. */
  action?: ReactNode;
  duration: string;
  time: string;
  row?: string | undefined;
};

const ICONS = {
  document: FileText,
  free: File,
  review_failed: ShieldX,
  workflow: Workflow,
  pull_request: GitPullRequest,
} satisfies Record<WorkflowIcon, LucideIcon>;

export function WorkflowCard({
  title,
  icon,
  runningIcon,
  pr,
  action,
  duration,
  time,
  row,
}: WorkflowCardProps): ReactElement {
  const Icon = ICONS[icon];
  const RunningIcon = runningIcon && ICONS[runningIcon];
  return (
    <div className="st-card" data-row={row}>
      <div className="st-card-head">
        {RunningIcon && <RunningIcon className="i14 st-card-run-icon" />}
        <Icon className="i14" />
        <b>{title}</b>
        {pr !== undefined && (
          <span className="st-pr st-card-pr">
            <GitPullRequest className="i14 when-open" />
            <span>PR #{pr}</span>
            <ExternalLink className="i12" />
          </span>
        )}
        <span className="st-pill">Running</span>
        <RowTime duration={duration} time={time} />
        {action && <span className="st-card-action">{action}</span>}
      </div>
    </div>
  );
}
