// The pull request link of a task card in task-pull-request-link.tsx: open, or merged.
import { ExternalLink, GitMerge, GitPullRequest } from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import { Badge } from "./Badge";

export function PrBadge({
  number,
  merged = false,
}: {
  number: number;
  merged?: boolean;
}): ReactElement {
  return (
    <Badge tone="pr" data-merged={flag(merged)} data-pr-badge>
      {merged ? <GitMerge /> : <GitPullRequest />}PR #{number}
      <ExternalLink className="i12" />
    </Badge>
  );
}
