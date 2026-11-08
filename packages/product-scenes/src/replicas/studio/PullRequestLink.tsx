// The pull request of the task in the session top bar: task-pull-request-link.tsx. The icon
// shows whether the pull request is open or merged, and a scene flips it with `data-merged`.
import { ExternalLink, GitMerge, GitPullRequest } from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import "./PullRequestLink.css";

type PullRequestLinkProps = { number: number; merged?: boolean };

export function PullRequestLink({ number, merged = false }: PullRequestLinkProps): ReactElement {
  return (
    <span className="st-pr" data-merged={flag(merged)} data-pr="">
      <GitPullRequest className="i14 when-open" />
      <GitMerge className="i14 when-merged" />
      <span>PR #{number}</span>
      <ExternalLink className="i12" />
    </span>
  );
}
