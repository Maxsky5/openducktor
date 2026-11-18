// The card of an ODT tool call that changes the task, in a mobile transcript, as WorkflowToolRow
// of workflow-tool-row.tsx in apps/mobile/src/features/session/transcript/rows. The card has the
// colors of the phase of the call: the info colors while it runs, with the RUNNING pill and the
// moving bars before its time, and the success colors when it ended, with its run time. The header
// shows the icon of the tool and its name. A Set Pull Request call that ended shows the pull
// request that it saved, as pull-request-link-button.tsx in
// apps/mobile/src/features/workflow/pull-requests: an outlined capsule with the state icon in its
// color, the pull request name, and an external link mark. workflow-card.ts changes `data-phase`.
import { ExternalLink, GitPullRequest } from "lucide-react";
import type { ReactElement } from "react";
import { RunningBars } from "./ToolRun";
import "./WorkflowToolCard.css";

/** The phase of a workflow call that a card shows: it runs, or it ended. */
export type WorkflowPhase = "executing" | "completed";

/** The status label of a running workflow call, as workflowToolStatusLabel gives it. */
export const WORKFLOW_RUNNING_LABEL = "RUNNING";

/** The short name of a pull request, as pullRequestLabel gives it. */
export function pullRequestName(number: number): string {
  return `PR #${number}`;
}

type WorkflowToolCardProps = {
  /** The name of the tool, such as Set Pull Request. */
  title: string;
  /** The number of the pull request that the call saved. */
  pullRequest: number;
  /** The run time of the call, such as 640ms. */
  duration: string;
  /** The clock time of the call, such as 10:14:44 AM. */
  time: string;
  phase: WorkflowPhase;
  row: string;
  hidden?: boolean | undefined;
};

export function WorkflowToolCard({
  title,
  pullRequest,
  duration,
  time,
  phase,
  row,
  hidden,
}: WorkflowToolCardProps): ReactElement {
  // The row holds the vertical margins of the card, as the cell of the list holds them, so a row
  // that covers a folding run keeps the colors of the card.
  return (
    <div
      className="mob-wf-row"
      data-row={row}
      data-workflow-tool=""
      data-phase={phase}
      hidden={hidden}
    >
      <div className="mob-wf">
        <div className="mob-wf-header">
          <GitPullRequest className="mob-wf-icon" />
          <span className="mob-wf-title">{title}</span>
          <span className="mob-wf-link" data-pr-link="">
            <GitPullRequest className="mob-wf-link-state" />
            <span>{pullRequestName(pullRequest)}</span>
            <ExternalLink className="mob-wf-link-out" />
          </span>
          <span className="mob-wf-pill">{WORKFLOW_RUNNING_LABEL}</span>
        </div>
        <span className="mob-wf-timing">
          <RunningBars />
          <span className="mob-wf-duration">{duration}</span>
          <span>{time}</span>
        </span>
      </div>
    </div>
  );
}
