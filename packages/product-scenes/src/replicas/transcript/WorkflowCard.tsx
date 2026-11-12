// An ODT tool card of agent-chat-workflow-tool-message.tsx: the icon, the title with the chevron
// that opens the closed details, the pull request of a completed odt_set_pull_request call, the
// status while the call runs, and the timing. A saved artifact reads "Set Spec" or "Reject QA",
// and a workflow event takes its event as the title, such as "Build Completed".
import {
  ChevronDown,
  ExternalLink,
  FileText,
  GitPullRequest,
  type LucideIcon,
  ShieldX,
  Workflow,
} from "lucide-react";
import type { ReactElement } from "react";
import type { WorkflowIcon } from "./model";
import { RowTime } from "./RowTime";
import "../studio/PullRequestLink.css";
import "./WorkflowCard.css";

type WorkflowCardProps = {
  title: string;
  icon: WorkflowIcon;
  /** The pull request that a completed odt_set_pull_request call saved. */
  pr?: number | undefined;
  duration: string;
  time: string;
  row?: string;
};

const ICONS = {
  document: FileText,
  review_failed: ShieldX,
  workflow: Workflow,
  pull_request: GitPullRequest,
} satisfies Record<WorkflowIcon, LucideIcon>;

export function WorkflowCard({
  title,
  icon,
  pr,
  duration,
  time,
  row,
}: WorkflowCardProps): ReactElement {
  const Icon = ICONS[icon];
  return (
    <div className="st-card" data-row={row}>
      <div className="st-card-head">
        <Icon className="i14" />
        <b>
          {title}
          <ChevronDown className="i12" />
        </b>
        {pr !== undefined && (
          <span className="st-pr st-card-pr">
            <GitPullRequest className="i14 when-open" />
            <span>PR #{pr}</span>
            <ExternalLink className="i12" />
          </span>
        )}
        <span className="st-pill">Running</span>
        <RowTime duration={duration} time={time} />
      </div>
    </div>
  );
}
